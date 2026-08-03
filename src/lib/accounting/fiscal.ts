import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";
import type {
  FiscalCoverageResult,
  FiscalOpenSuggestion,
  ResolvedFiscalPeriod,
} from "@/lib/accounting/fiscal-types";

export type { ResolvedFiscalPeriod } from "@/lib/accounting/fiscal-types";

const PERIOD_SELECT = `
  p.id, p.fiscal_year_id, p.period_no, p.name,
  p.start_date::text AS start_date,
  p.end_date::text AS end_date,
  p.status,
  y.code AS fiscal_year_code,
  y.name AS fiscal_year_name,
  y.is_active AS fiscal_year_is_active
`;

/**
 * Resolve OPEN period covering entry_date for company.
 */
export async function resolveOpenFiscalPeriod(
  entryDate: string,
  companyId: string | null,
  client?: PoolClient
): Promise<ResolvedFiscalPeriod | null> {
  const sql = `
    SELECT ${PERIOD_SELECT}
    FROM accounting.fiscal_periods p
    JOIN accounting.fiscal_years y
      ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
    WHERE y.is_active = true
      AND p.status = 'OPEN'
      AND p.start_date <= $1::date
      AND p.end_date >= $1::date
      AND (
        ($2::uuid IS NULL AND y.company_id IS NULL)
        OR ($2::uuid IS NOT NULL AND y.company_id = $2::uuid)
      )
    ORDER BY p.period_no ASC
    LIMIT 1`;

  if (client) {
    const { rows } = await client.query<ResolvedFiscalPeriod>(sql, [
      entryDate,
      companyId,
    ]);
    return rows[0] ?? null;
  }

  return queryOne<ResolvedFiscalPeriod>(sql, [entryDate, companyId]);
}

export async function assertOpenFiscalPeriod(
  entryDate: string,
  companyId: string | null,
  client?: PoolClient
): Promise<ResolvedFiscalPeriod> {
  const period = await resolveOpenFiscalPeriod(entryDate, companyId, client);
  if (!period) {
    throw new Error(
      "Tidak ada fiscal period OPEN untuk tanggal jurnal. Konfigurasi Fiscal Years terlebih dahulu."
    );
  }
  return period;
}

async function findPeriodCoveringDate(
  entryDate: string,
  companyId: string | null
): Promise<ResolvedFiscalPeriod | null> {
  return queryOne<ResolvedFiscalPeriod>(
    `SELECT ${PERIOD_SELECT}
     FROM accounting.fiscal_periods p
     JOIN accounting.fiscal_years y
       ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
     WHERE y.is_active = true
       AND p.start_date <= $1::date
       AND p.end_date >= $1::date
       AND (
         ($2::uuid IS NULL AND y.company_id IS NULL)
         OR ($2::uuid IS NOT NULL AND y.company_id = $2::uuid)
       )
     ORDER BY p.period_no ASC
     LIMIT 1`,
    [entryDate, companyId]
  );
}

/**
 * Coverage + saran OPEN period untuk tanggal jurnal.
 * Jika period menutupi tanggal masih CLOSED, suggest buka
 * (dengan daftar previous OPEN yang perlu di-close dulu).
 */
export async function resolveFiscalCoverage(
  entryDate: string,
  companyId: string | null
): Promise<FiscalCoverageResult> {
  const open = await resolveOpenFiscalPeriod(entryDate, companyId);
  if (open) {
    return {
      date: entryDate,
      ready: true,
      period: open,
      suggestion: null,
    };
  }

  const covering = await findPeriodCoveringDate(entryDate, companyId);
  if (!covering || covering.status === "OPEN") {
    // Tidak ada period sama sekali, atau anomali
    return {
      date: entryDate,
      ready: false,
      period: null,
      suggestion: null,
    };
  }

  // Period CLOSED → cek previous OPEN di year yang sama
  const previousOpen = await query<{
    id: string;
    period_no: number;
    name: string;
  }>(
    `SELECT id, period_no, name
     FROM accounting.fiscal_periods
     WHERE fiscal_year_id = $1
       AND period_no < $2
       AND status = 'OPEN'
     ORDER BY period_no ASC`,
    [covering.fiscal_year_id, covering.period_no]
  );

  // Cek fiscal year sebelumnya masih punya OPEN
  const priorYearOpen = await queryOne<{ code: string; open_count: string }>(
    `SELECT y.code, COUNT(p.id)::text AS open_count
     FROM accounting.fiscal_years y
     JOIN accounting.fiscal_periods p ON p.fiscal_year_id = y.id
     JOIN accounting.fiscal_years cur ON cur.id = $1
     WHERE y.deleted_at IS NULL
       AND y.end_date < cur.start_date
       AND p.status = 'OPEN'
       AND (
         (cur.company_id IS NULL AND y.company_id IS NULL)
         OR (cur.company_id IS NOT NULL AND y.company_id = cur.company_id)
       )
     GROUP BY y.id, y.code
     HAVING COUNT(p.id) > 0
     ORDER BY y.end_date DESC
     LIMIT 1`,
    [covering.fiscal_year_id]
  );

  if (priorYearOpen) {
    const suggestion: FiscalOpenSuggestion = {
      period: covering,
      can_open: false,
      close_previous: [],
      message: `Period ${covering.name} masih CLOSED, tapi fiscal year ${priorYearOpen.code} masih punya ${priorYearOpen.open_count} period OPEN. Closing fiscal sebelumnya dulu.`,
    };
    return {
      date: entryDate,
      ready: false,
      period: null,
      suggestion,
    };
  }

  const closeNames = previousOpen.map((p) => p.name).join(", ");
  const suggestion: FiscalOpenSuggestion = {
    period: covering,
    can_open: true,
    close_previous: previousOpen,
    message:
      previousOpen.length > 0
        ? `Period ${covering.name} belum OPEN. Sistem bisa menutup ${closeNames} lalu membuka ${covering.name}.`
        : `Period ${covering.name} belum OPEN. Buka sekarang agar bisa input jurnal di tanggal ini.`,
  };

  return {
    date: entryDate,
    ready: false,
    period: null,
    suggestion,
  };
}

/**
 * Buka period target. Jika closePrevious=true, otomatis CLOSE period
 * sebelumnya yang masih OPEN di fiscal year yang sama.
 */
export async function openFiscalPeriodById(opts: {
  periodId: string;
  userId: string;
  companyId: string | null;
  closePrevious: boolean;
}): Promise<ResolvedFiscalPeriod> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<
      ResolvedFiscalPeriod & { company_id: string | null }
    >(
      `SELECT ${PERIOD_SELECT}, y.company_id
       FROM accounting.fiscal_periods p
       JOIN accounting.fiscal_years y
         ON y.id = p.fiscal_year_id AND y.deleted_at IS NULL
       WHERE p.id = $1`,
      [opts.periodId]
    );
    const target = rows[0];
    if (!target) throw new Error("Fiscal period tidak ditemukan");
    if (!target.fiscal_year_is_active) {
      throw new Error("Fiscal year tidak aktif");
    }
    if (
      opts.companyId != null &&
      target.company_id != null &&
      target.company_id !== opts.companyId
    ) {
      throw new Error("Fiscal period di luar scope company");
    }
    if (target.status === "OPEN") {
      return target;
    }

    // Block jika fiscal year sebelumnya belum fully closed
    const priorYearOpen = await client.query<{ code: string }>(
      `SELECT y.code
       FROM accounting.fiscal_years y
       JOIN accounting.fiscal_periods p ON p.fiscal_year_id = y.id
       JOIN accounting.fiscal_years cur ON cur.id = $1
       WHERE y.deleted_at IS NULL
         AND y.end_date < cur.start_date
         AND p.status = 'OPEN'
         AND (
           (cur.company_id IS NULL AND y.company_id IS NULL)
           OR (cur.company_id IS NOT NULL AND y.company_id = cur.company_id)
         )
       GROUP BY y.id, y.code
       HAVING COUNT(p.id) > 0
       LIMIT 1`,
      [target.fiscal_year_id]
    );
    if (priorYearOpen.rows[0]) {
      throw new Error(
        `Tidak bisa OPEN: fiscal year ${priorYearOpen.rows[0].code} belum fully CLOSED`
      );
    }

    const prevOpen = await client.query<{
      id: string;
      period_no: number;
      name: string;
    }>(
      `SELECT id, period_no, name
       FROM accounting.fiscal_periods
       WHERE fiscal_year_id = $1
         AND period_no < $2
         AND status = 'OPEN'
       ORDER BY period_no ASC`,
      [target.fiscal_year_id, target.period_no]
    );

    if (prevOpen.rows.length > 0) {
      if (!opts.closePrevious) {
        throw new Error(
          `Tutup period ${prevOpen.rows.map((p) => p.name).join(", ")} terlebih dahulu sebelum OPEN ${target.name}`
        );
      }
      await client.query(
        `UPDATE accounting.fiscal_periods
         SET status = 'CLOSED', updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [prevOpen.rows.map((p) => p.id)]
      );
    }

    await client.query(
      `UPDATE accounting.fiscal_periods
       SET status = 'OPEN', updated_at = now()
       WHERE id = $1`,
      [opts.periodId]
    );
    await client.query(
      `UPDATE accounting.fiscal_years
       SET updated_by = $2, updated_at = now()
       WHERE id = $1`,
      [target.fiscal_year_id, opts.userId]
    );

    const refreshed = await client.query<ResolvedFiscalPeriod>(
      `SELECT ${PERIOD_SELECT}
       FROM accounting.fiscal_periods p
       JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
       WHERE p.id = $1`,
      [opts.periodId]
    );
    return refreshed.rows[0];
  });
}
