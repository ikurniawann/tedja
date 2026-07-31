import { query, queryOne } from "@/lib/db";
import {
  projectRunRate,
  summarizePeriod,
  type Comparison,
  type Period,
  type PeriodKind,
  type PeriodSummary,
} from "./period";

export type { PeriodSummary } from "./period";

/**
 * Data papan monitoring desktop Arkiv OS (EPIC-019 Fase A).
 *
 * Prinsip:
 * - Definisi angka MENGIKUTI modulnya, bukan menulis ulang: pending approval
 *   memakai definisi nav-badges (`status='pending'` pada tabel yang sama),
 *   penjualan memakai filter yang sama dengan tool Do `penjualan_periode`,
 *   stok memakai query `stok_menipis`. Selisih angka desktop vs halaman modul
 *   adalah bug, bukan "beda definisi".
 * - Tiap seksi gagal-aman: satu query error → seksi itu bernilai null dan
 *   dicatat, seksi lain tetap terisi. Desktop tidak boleh mati karena satu tabel.
 */

export interface SalesPulse {
  hariIni: { omzet: number; pesanan: number; rataRata: number };
  kemarin: { omzet: number; pesanan: number };
  /** Hari yang sama minggu lalu (H-7) — pembanding pola mingguan (Fase C). */
  mingguLalu: { omzet: number; pesanan: number };
  /** Omzet per hari, 7 hari terakhir (indeks 6 = hari ini) — bahan sparkline. */
  tujuhHari: Array<{ tanggal: string; omzet: number }>;
}

export interface TeamToday {
  aktif: number;
  hadir: number;
  terlambat: number;
  cuti: number;
  belum: number;
}

export interface PendingDecisions {
  cuti: number;
  lembur: number;
  pinjaman: number;
  poDraft: number;
  kandidatBaru: number;
  total: number;
}

export interface LowStockItem {
  bahan: string;
  tersedia: number;
  minimum: number;
}

export interface LowStock {
  jumlah: number;
  teratas: LowStockItem[];
}

export interface CrmPulse {
  memberBaru7Hari: number;
  xpTerdistribusi7Hari: number;
  rewardDitukar7Hari: number;
}

/**
 * Omzet sepanjang periode terpilih — dasar Revenue Overview (Fase B).
 *
 * `adaData` sengaja dipisah dari `omzet: 0`: tanpa itu, periode yang belum punya
 * transaksi terbaca sebagai "penjualan nol" oleh owner, padahal artinya "belum
 * ada yang tercatat". Dua hal berbeda dengan tindak lanjut berbeda.
 */
export interface RevenuePeriod {
  omzet: number;
  pesanan: number;
  banding: { omzet: number; pesanan: number };
  /** Proyeksi akhir periode dari laju berjalan. */
  proyeksi: number;
  adaData: boolean;
}

export interface DesktopOverview {
  dibuatPada: string;
  /** Metadata periode papan — dipakai UI untuk melabeli angka & pembandingnya. */
  periode: PeriodSummary;
  omzetPeriode: RevenuePeriod | null;
  pulsaBisnis: SalesPulse | null;
  timHariIni: TeamToday | null;
  perluKeputusan: PendingDecisions | null;
  stokMenipis: LowStock | null;
  member: CrmPulse | null;
  /** Seksi yang gagal dimuat — dipakai UI untuk menandai kartunya. */
  gagal: string[];
}

/** Tanggal operasional WIB — tanggal server belum tentu sama. */
export function todayJakarta(now = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchSalesPulse(): Promise<SalesPulse> {
  const today = todayJakarta();
  // Filter identik dengan tool Do `penjualan_periode`: pesanan batal & void
  // tidak dihitung.
  // Rentang -7 hari (bukan -6) supaya hari yang sama minggu lalu ikut terambil
  // untuk pembanding mingguan; sparkline tetap memakai 7 titik terakhir.
  const rows = await query<{ tanggal: string; omzet: string; pesanan: string }>(
    `SELECT (created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS tanggal,
            COALESCE(sum(total_amount), 0)::float8 AS omzet,
            count(*)::int AS pesanan
       FROM pos.pos_orders
      WHERE created_at >= ($1::date - interval '7 days')
        AND created_at < ($1::date + interval '1 day')
        AND status <> 'cancelled'
        AND voided_at IS NULL
      GROUP BY 1
      ORDER BY 1`,
    [today]
  );

  const byDate = new Map(rows.map((r) => [r.tanggal, { omzet: Number(r.omzet), pesanan: Number(r.pesanan) }]));
  const tujuhHari: SalesPulse["tujuhHari"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(new Date(`${today}T00:00:00Z`).getTime() - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    tujuhHari.push({ tanggal: d, omzet: byDate.get(d)?.omzet ?? 0 });
  }

  const hariIni = byDate.get(today) ?? { omzet: 0, pesanan: 0 };
  const kemarinTgl = tujuhHari[5]?.tanggal ?? today;
  const kemarin = byDate.get(kemarinTgl) ?? { omzet: 0, pesanan: 0 };
  const mingguLaluTgl = new Date(new Date(`${today}T00:00:00Z`).getTime() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const mingguLalu = byDate.get(mingguLaluTgl) ?? { omzet: 0, pesanan: 0 };

  return {
    hariIni: {
      omzet: hariIni.omzet,
      pesanan: hariIni.pesanan,
      rataRata: hariIni.pesanan > 0 ? hariIni.omzet / hariIni.pesanan : 0,
    },
    kemarin: { omzet: kemarin.omzet, pesanan: kemarin.pesanan },
    mingguLalu: { omzet: mingguLalu.omzet, pesanan: mingguLalu.pesanan },
    tujuhHari,
  };
}

/**
 * Omzet periode + jendela pembandingnya dalam satu query.
 *
 * Filter mengikuti definisi modul POS (batal & void tidak dihitung), sama
 * seperti `fetchSalesPulse` dan tool Do `penjualan_periode` — selisih angka
 * papan vs halaman modul adalah bug, bukan beda definisi.
 *
 * Tanggal dibandingkan sebagai tanggal WIB (`AT TIME ZONE`), bukan rentang
 * timestamp mentah, supaya batas hari mengikuti hari operasional Jakarta.
 *
 * Tidak difilter tenant: papan digate ke super_admin/direksi dan memang
 * dimaksudkan lintas-unit — konsisten dengan seluruh query di modul ini.
 */
async function fetchRevenuePeriod(
  period: Period,
  banding: Comparison
): Promise<RevenuePeriod> {
  const row = await queryOne<{
    omzet: string;
    pesanan: number;
    banding_omzet: string;
    banding_pesanan: number;
    baris: number;
  }>(
    `WITH terpakai AS (
       SELECT total_amount,
              (created_at AT TIME ZONE 'Asia/Jakarta')::date AS tanggal
         FROM pos.pos_orders
        WHERE status <> 'cancelled'
          AND voided_at IS NULL
     )
     SELECT
       COALESCE(sum(total_amount) FILTER (WHERE tanggal BETWEEN $1::date AND $2::date), 0)::float8 AS omzet,
       count(*) FILTER (WHERE tanggal BETWEEN $1::date AND $2::date)::int AS pesanan,
       COALESCE(sum(total_amount) FILTER (WHERE tanggal BETWEEN $3::date AND $4::date), 0)::float8 AS banding_omzet,
       count(*) FILTER (WHERE tanggal BETWEEN $3::date AND $4::date)::int AS banding_pesanan,
       count(*) FILTER (WHERE tanggal BETWEEN $3::date AND $2::date)::int AS baris
       FROM terpakai`,
    [period.mulai, period.selesai, banding.mulai, banding.selesai]
  );

  const omzet = Number(row?.omzet ?? 0);
  const pesanan = Number(row?.pesanan ?? 0);
  return {
    omzet,
    pesanan,
    banding: {
      omzet: Number(row?.banding_omzet ?? 0),
      pesanan: Number(row?.banding_pesanan ?? 0),
    },
    proyeksi: projectRunRate(omzet, period),
    // Sepanjang rentang pembanding s/d sekarang tidak ada satu pun transaksi →
    // ini "belum ada data", bukan "penjualan nol".
    adaData: Number(row?.baris ?? 0) > 0,
  };
}

async function fetchTeamToday(): Promise<TeamToday> {
  const today = todayJakarta();
  const row = await queryOne<{
    aktif: number;
    hadir: number;
    terlambat: number;
    cuti: number;
  }>(
    `SELECT
       (SELECT count(*) FROM hris.employees WHERE is_active)::int AS aktif,
       (SELECT count(*) FROM hris.attendance WHERE date = $1::date)::int AS hadir,
       (SELECT count(*) FROM hris.attendance WHERE date = $1::date AND is_late)::int AS terlambat,
       (SELECT count(DISTINCT l.employee_id)
          FROM hris.leaves l
          JOIN hris.employees e ON e.id = l.employee_id AND e.is_active
         WHERE l.status = 'approved'
           AND $1::date BETWEEN l.start_date AND l.end_date)::int AS cuti`,
    [today]
  );

  const aktif = row?.aktif ?? 0;
  const hadir = row?.hadir ?? 0;
  const cuti = row?.cuti ?? 0;
  return {
    aktif,
    hadir,
    terlambat: row?.terlambat ?? 0,
    cuti,
    belum: Math.max(0, aktif - hadir - cuti),
  };
}

async function fetchPendingDecisions(): Promise<PendingDecisions> {
  // Definisi 'pending' identik dengan nav-badges (lib/hris/nav-badges.ts);
  // PO memakai status 'draft' sesuai enum purchase_orders (draft → approved).
  const row = await queryOne<{
    cuti: number;
    lembur: number;
    pinjaman: number;
    po_draft: number;
    kandidat: number;
  }>(
    `SELECT
       (SELECT count(*) FROM hris.leaves WHERE status = 'pending')::int AS cuti,
       (SELECT count(*) FROM hris.overtime_requests WHERE status = 'pending')::int AS lembur,
       (SELECT count(*) FROM hris.loans WHERE status = 'pending')::int AS pinjaman,
       (SELECT count(*) FROM purchase_orders WHERE status = 'draft')::int AS po_draft,
       (SELECT count(*) FROM recruitment.candidates WHERE status = 'applied')::int AS kandidat`
  );

  const cuti = row?.cuti ?? 0;
  const lembur = row?.lembur ?? 0;
  const pinjaman = row?.pinjaman ?? 0;
  const poDraft = row?.po_draft ?? 0;
  const kandidatBaru = row?.kandidat ?? 0;
  return {
    cuti,
    lembur,
    pinjaman,
    poDraft,
    kandidatBaru,
    total: cuti + lembur + pinjaman + poDraft + kandidatBaru,
  };
}

async function fetchLowStock(): Promise<LowStock> {
  // Query identik dengan tool Do `stok_menipis`.
  const rows = await query<{ bahan: string; tersedia: number; minimum: number }>(
    `SELECT rm.nama AS bahan,
            i.qty_available::float8 AS tersedia,
            i.qty_minimum::float8 AS minimum
       FROM inventory.inventory i
       JOIN item.raw_materials rm ON rm.id = i.raw_material_id
      WHERE i.is_active
        AND rm.deleted_at IS NULL
        AND i.qty_available <= i.qty_minimum
      ORDER BY (i.qty_minimum - i.qty_available) DESC`
  );
  return {
    jumlah: rows.length,
    teratas: rows.slice(0, 3).map((r) => ({
      bahan: r.bahan,
      tersedia: Number(r.tersedia),
      minimum: Number(r.minimum),
    })),
  };
}

async function fetchCrmPulse(): Promise<CrmPulse> {
  const row = await queryOne<{ member: number; xp: number; redeem: number }>(
    `SELECT
       (SELECT count(*) FROM crm_member_profiles
         WHERE created_at > now() - interval '7 days')::int AS member,
       (SELECT COALESCE(sum(xp_delta), 0) FROM crm_xp_ledger
         WHERE created_at > now() - interval '7 days' AND xp_delta > 0)::int AS xp,
       (SELECT count(*) FROM crm_redemptions
         WHERE created_at > now() - interval '7 days')::int AS redeem`
  );
  return {
    memberBaru7Hari: row?.member ?? 0,
    xpTerdistribusi7Hari: row?.xp ?? 0,
    rewardDitukar7Hari: row?.redeem ?? 0,
  };
}

/** Satu seksi gagal → null + tercatat; jangan menjatuhkan seksi lain. */
async function safeSection<T>(
  name: string,
  gagal: string[],
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[desktop:overview] seksi ${name} gagal:`, error);
    gagal.push(name);
    return null;
  }
}

/**
 * @param kind Periode papan (EPIC-037 Fase A). Default `today` — nilai lama,
 *   supaya pemanggil yang belum diperbarui tidak berubah artinya.
 *
 * Catatan sengaja: `timHariIni`, `perluKeputusan`, dan `stokMenipis` TIDAK
 * mengikuti periode. Ketiganya menggambarkan keadaan SEKARANG (siapa hadir hari
 * ini, apa yang menunggu approval, stok apa yang menipis) — "stok menipis YTD"
 * bukan pertanyaan yang punya arti. Yang mengikuti periode hanya angka yang
 * memang berbentuk akumulasi.
 */
export async function buildDesktopOverview(
  kind: PeriodKind = "today"
): Promise<DesktopOverview> {
  const gagal: string[] = [];
  const ringkasan = summarizePeriod(kind);

  const [omzetPeriode, pulsaBisnis, timHariIni, perluKeputusan, stokMenipis, member] =
    await Promise.all([
      safeSection("omzetPeriode", gagal, () =>
        fetchRevenuePeriod(ringkasan.periode, ringkasan.banding)
      ),
      safeSection("pulsaBisnis", gagal, fetchSalesPulse),
      safeSection("timHariIni", gagal, fetchTeamToday),
      safeSection("perluKeputusan", gagal, fetchPendingDecisions),
      safeSection("stokMenipis", gagal, fetchLowStock),
      safeSection("member", gagal, fetchCrmPulse),
    ]);

  return {
    dibuatPada: new Date().toISOString(),
    periode: ringkasan,
    omzetPeriode,
    pulsaBisnis,
    timHariIni,
    perluKeputusan,
    stokMenipis,
    member,
    gagal,
  };
}

/** Role yang boleh melihat papan monitoring (keputusan owner 2026-07-21).
 *  `owner` belum ada di iam.roles; `direksi` adalah padanannya. */
export const DESKTOP_OVERVIEW_ROLES = ["super_admin", "direksi"] as const;
