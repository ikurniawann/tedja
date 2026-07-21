import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { paginatedResponse, successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  PAYMENT_MODES,
  TICKETING_OPERATOR_ROLES,
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// Metode uang fisik yang diterima loket/kasir — konsisten dengan POS.
const CASH_METHODS = ["cash", "qris", "card"] as const;

const VISIT_STATUSES = ["open", "settled", "void"] as const;

interface VisitListRow {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  payment_mode: "postpaid" | "prepaid";
  credit_limit: string | null;
  status: (typeof VISIT_STATUSES)[number];
  opened_at: string;
  settled_at: string | null;
  band_count: string;
  active_band_count: string;
  debit: string;
  kredit: string;
  total_count: string;
}

export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const sp = request.nextUrl.searchParams;
    const status = VISIT_STATUSES.includes(
      sp.get("status") as (typeof VISIT_STATUSES)[number]
    )
      ? (sp.get("status") as string)
      : "open";
    const q = (sp.get("q") ?? "").trim();
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));

    const conditions = ["v.branch_id = $1", "v.company_id = $2", "v.status = $3"];
    const params: unknown[] = [ctx.branchId, ctx.companyId, status];
    if (q) {
      params.push(`%${q}%`, normalizeNfcUid(q) || q);
      conditions.push(
        `(v.contact_name ILIKE $${params.length - 1}
          OR v.contact_phone ILIKE $${params.length - 1}
          OR EXISTS (
            SELECT 1 FROM ticketing.ticket_visit_bands vb
            JOIN ticketing.ticket_bands b ON b.id = vb.band_id
            WHERE vb.visit_id = v.id AND b.nfc_uid = $${params.length}
          ))`
      );
    }

    params.push(limit, (page - 1) * limit);
    const rows = await query<VisitListRow>(
      `SELECT v.id, v.contact_name, v.contact_phone, v.payment_mode,
              v.credit_limit, v.status, v.opened_at, v.settled_at,
              (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
               WHERE vb.visit_id = v.id) AS band_count,
              (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
               WHERE vb.visit_id = v.id AND vb.status = 'aktif') AS active_band_count,
              COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
               WHERE c.visit_id = v.id AND c.direction = 'debit'), 0) AS debit,
              COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
               WHERE c.visit_id = v.id AND c.direction = 'kredit'), 0) AS kredit,
              COUNT(*) OVER() AS total_count
       FROM ticketing.ticket_visits v
       WHERE ${conditions.join(" AND ")}
       ORDER BY v.opened_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const data = rows.map((row) => {
      const { total_count, ...visit } = row;
      void total_count;
      const debit = Number(visit.debit);
      const kredit = Number(visit.kredit);
      return {
        ...visit,
        band_count: Number(visit.band_count),
        active_band_count: Number(visit.active_band_count),
        debit,
        kredit,
        outstanding: Math.round((debit - kredit) * 100) / 100,
        saldo: Math.round((kredit - debit) * 100) / 100,
      };
    });
    return paginatedResponse(data, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[ticketing] list visits error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar kunjungan" },
      { status: 500 }
    );
  }
}

const registerVisitSchema = z.object({
  contact_name: z.string().trim().min(1).max(150),
  contact_phone: z.string().trim().max(30).optional().nullable(),
  payment_mode: z.enum(PAYMENT_MODES),
  // plafon khusus visit ini; kosong = default venue dari ticket_settings
  credit_limit: z.number().min(0).max(1_000_000_000).optional().nullable(),
  deposit: z
    .object({
      amount: z.number().positive().max(1_000_000_000),
      method: z.enum(CASH_METHODS),
    })
    .optional()
    .nullable(),
  bands: z
    .array(
      z.object({
        nfc_uid: z.string().trim().min(1).max(80),
        ticket_type_id: z.string().uuid(),
      })
    )
    .min(1)
    .max(50),
});

export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-register:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak registrasi — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = registerVisitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const uids = body.bands.map((b) => normalizeNfcUid(b.nfc_uid));
    if (uids.some((uid) => !isValidNfcUid(uid))) {
      return NextResponse.json(
        { success: false, error: "Ada UID gelang yang tidak valid" },
        { status: 400 }
      );
    }
    if (new Set(uids).size !== uids.length) {
      return NextResponse.json(
        { success: false, error: "Ada gelang yang di-tap dua kali" },
        { status: 400 }
      );
    }
    if (body.payment_mode === "prepaid" && !body.deposit) {
      return NextResponse.json(
        { success: false, error: "Mode prepaid wajib top-up deposit awal" },
        { status: 400 }
      );
    }

    const result = await withTransaction(async (client) => {
      // Default plafon dari pengaturan venue (postpaid)
      const settingsResult = await client.query<{
        default_credit_limit: string;
      }>(
        `SELECT default_credit_limit FROM ticketing.ticket_settings
         WHERE branch_id = $1 AND company_id = $2`,
        [ctx.branchId, ctx.companyId]
      );
      const defaultLimit = settingsResult.rows[0]
        ? Number(settingsResult.rows[0].default_credit_limit)
        : 500000;

      const channelResult = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_channels
         WHERE branch_id = $1 AND company_id = $2 AND code = 'walk-in'
           AND is_active = true`,
        [ctx.branchId, ctx.companyId]
      );
      if (channelResult.rows.length === 0) {
        throw Object.assign(
          new Error("Kanal walk-in belum aktif — buka Pengaturan Tiket dulu"),
          { statusCode: 400 }
        );
      }
      const channelId = channelResult.rows[0].id;

      // Kunci gelang deterministik (ORDER BY id — hindari deadlock)
      const bandsResult = await client.query<{
        id: string;
        nfc_uid: string;
        status: string;
      }>(
        `SELECT id, nfc_uid, status FROM ticketing.ticket_bands
         WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = ANY($3)
         ORDER BY id
         FOR UPDATE`,
        [ctx.branchId, ctx.companyId, uids]
      );
      const bandByUid = new Map(bandsResult.rows.map((b) => [b.nfc_uid, b]));
      for (const uid of uids) {
        const band = bandByUid.get(uid);
        if (!band) {
          throw Object.assign(
            new Error(`Gelang ${uid} belum terdaftar di registry`),
            { statusCode: 400 }
          );
        }
        if (band.status !== "tersedia") {
          throw Object.assign(
            new Error(`Gelang ${uid} berstatus "${band.status}" — tidak bisa dipakai`),
            { statusCode: 409 }
          );
        }
      }

      const typeIds = [...new Set(body.bands.map((b) => b.ticket_type_id))];
      const typesResult = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_types
         WHERE branch_id = $1 AND company_id = $2 AND id = ANY($3)
           AND is_active = true`,
        [ctx.branchId, ctx.companyId, typeIds]
      );
      if (typesResult.rows.length !== typeIds.length) {
        throw Object.assign(
          new Error("Ada jenis tiket yang tidak dikenal / nonaktif"),
          { statusCode: 400 }
        );
      }

      const creditLimit =
        body.payment_mode === "postpaid"
          ? (body.credit_limit ?? defaultLimit)
          : null;

      const visitResult = await client.query<{ id: string }>(
        `INSERT INTO ticketing.ticket_visits
           (company_id, branch_id, contact_name, contact_phone, channel_id,
            payment_mode, credit_limit, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          ctx.companyId,
          ctx.branchId,
          body.contact_name,
          body.contact_phone || null,
          channelId,
          body.payment_mode,
          creditLimit,
          ctx.user.id,
        ]
      );
      const visitId = visitResult.rows[0].id;

      for (const item of body.bands) {
        const uid = normalizeNfcUid(item.nfc_uid);
        const band = bandByUid.get(uid)!;
        await client.query(
          `INSERT INTO ticketing.ticket_visit_bands
             (company_id, branch_id, visit_id, band_id, ticket_type_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [ctx.companyId, ctx.branchId, visitId, band.id, item.ticket_type_id]
        );
        await client.query(
          `UPDATE ticketing.ticket_bands
           SET status = 'dipakai', updated_at = now()
           WHERE id = $1`,
          [band.id]
        );
      }

      if (body.payment_mode === "prepaid" && body.deposit) {
        await client.query(
          `INSERT INTO ticketing.ticket_visit_charges
             (company_id, branch_id, visit_id, charge_type, direction,
              description, amount, payment_method, created_by)
           VALUES ($1, $2, $3, 'deposit', 'kredit', $4, $5, $6, $7)`,
          [
            ctx.companyId,
            ctx.branchId,
            visitId,
            `Top-up deposit awal (${body.deposit.method})`,
            Math.round(body.deposit.amount * 100) / 100,
            body.deposit.method,
            ctx.user.id,
          ]
        );
      }

      return { visitId };
    });

    return successResponse({ id: result.visitId }, "Kunjungan terdaftar");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] register visit error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mendaftarkan kunjungan" },
      { status: 500 }
    );
  }
}
