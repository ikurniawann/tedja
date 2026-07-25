// EPIC-031 Fase B1 — sisi server kuota harian venue: hitung okupansi live
// (booking online + walk-in loket) dan guard anti-oversell DI BAWAH advisory
// lock. Semua fungsi menerima PoolClient supaya berjalan DI DALAM transaksi
// pemanggil (create booking / registrasi loket) — jangan panggil di luar
// withTransaction untuk jalur tulis.

import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import {
  CAPACITY_HOLDING_BOOKING_STATUSES,
  isCapacityExceeded,
  resolveDailyCapacity,
  type CapacityDateRange,
} from "./capacity";

export interface VenueScope {
  companyId: string;
  branchId: string;
}

/**
 * Serialisasi transaksi kapasitas per (venue, tanggal) — advisory lock
 * transaksional (lepas otomatis saat COMMIT/ROLLBACK). Dua transaksi pada
 * tanggal yang sama antre; tanggal/venue berbeda jalan paralel. Tabrakan
 * hash antar-kunci hanya menambah serialisasi, tidak salah hasil.
 */
export async function acquireCapacityLock(
  client: PoolClient,
  scope: VenueScope,
  date: string
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [scope.branchId, date]
  );
}

/**
 * Kapasitas efektif tanggal ini dari config: default venue + override
 * aktif yang mencakup tanggal (overlap → terkecil, resolver murni).
 * null = unlimited (kuota tidak aktif).
 */
export async function loadEffectiveCapacity(
  client: PoolClient,
  scope: VenueScope,
  date: string
): Promise<number | null> {
  const settings = await client.query<{ daily_capacity: number | null }>(
    `SELECT daily_capacity FROM ticketing.ticket_settings
     WHERE branch_id = $1 AND company_id = $2`,
    [scope.branchId, scope.companyId]
  );
  // Venue belum bootstrap settings = belum pernah set kuota → unlimited
  const venueDefault = settings.rows[0]?.daily_capacity ?? null;

  const overrides = await client.query<CapacityDateRange>(
    `SELECT start_date::text AS start_date, end_date::text AS end_date,
            capacity, is_active
     FROM ticketing.ticket_capacity_dates
     WHERE branch_id = $1 AND company_id = $2 AND is_active = true
       AND start_date <= $3::date AND $3::date <= end_date`,
    [scope.branchId, scope.companyId, date]
  );
  return resolveDailyCapacity(date, venueDefault, overrides.rows);
}

/**
 * Okupansi live satu tanggal (per ORANG) — hitung ulang dari sumber, tanpa
 * counter (jangan percaya state):
 *   • Online: guest booking ber-status memegang kuota (menunggu-bayar =
 *     reservasi, terbayar, digunakan). kedaluwarsa/dibatalkan/hangus lepas.
 *   • Walk-in: gelang terdaftar di visit non-void yang dibuka tanggal itu
 *     (WIB). Visit hasil REDEEM booking DIKECUALIKAN — orangnya sudah
 *     terhitung di sisi booking (anti dobel-hitung, keputusan owner 25 Jul).
 */
export async function countCapacityUsed(
  client: PoolClient,
  scope: VenueScope,
  date: string
): Promise<number> {
  const result = await client.query<{ online: string; walk_in: string }>(
    `SELECT
       (SELECT COUNT(*)
        FROM ticketing.ticket_booking_guests g
        JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
        WHERE b.branch_id = $1 AND b.company_id = $2
          AND b.visit_date = $3::date
          AND b.status = ANY($4)) AS online,
       (SELECT COUNT(*)
        FROM ticketing.ticket_visit_bands vb
        JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
        WHERE v.branch_id = $1 AND v.company_id = $2
          AND v.status <> 'void'
          AND (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date = $3::date
          AND NOT EXISTS (
            SELECT 1 FROM ticketing.ticket_bookings bk
            WHERE bk.visit_id = v.id
          )) AS walk_in`,
    [
      scope.branchId,
      scope.companyId,
      date,
      [...CAPACITY_HOLDING_BOOKING_STATUSES],
    ]
  );
  const row = result.rows[0];
  return Number(row.online) + Number(row.walk_in);
}

/**
 * Status ketersediaan per tanggal utk kalender publik (B3). HANYA tanggal
 * bermasalah yang dikembalikan — tanggal tersedia diomit (payload kecil,
 * dan angka sisa/kapasitas TIDAK pernah bocor ke publik, keputusan owner).
 */
export type UnavailableKind = "sold_out" | "closed";

const addDaysIso = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * Peta tanggal tidak-tersedia dalam rentang [from..to] (inklusif) —
 * read-only tanpa lock (kalender indikatif; kebenaran final tetap guard
 * transaksi create). Fast path: kuota venue non-aktif & tanpa override →
 * langsung {} tanpa query okupansi.
 */
export async function buildAvailability(
  scope: VenueScope,
  from: string,
  to: string
): Promise<Record<string, UnavailableKind>> {
  const [settingsRows, overrideRows] = await Promise.all([
    query<{ daily_capacity: number | null }>(
      `SELECT daily_capacity FROM ticketing.ticket_settings
       WHERE branch_id = $1 AND company_id = $2`,
      [scope.branchId, scope.companyId]
    ),
    query<CapacityDateRange>(
      `SELECT start_date::text AS start_date, end_date::text AS end_date,
              capacity, is_active
       FROM ticketing.ticket_capacity_dates
       WHERE branch_id = $1 AND company_id = $2 AND is_active = true
         AND start_date <= $4::date AND $3::date <= end_date`,
      [scope.branchId, scope.companyId, from, to]
    ),
  ]);
  const venueDefault = settingsRows[0]?.daily_capacity ?? null;
  if (venueDefault === null && overrideRows.length === 0) return {};

  const [onlineRows, walkInRows] = await Promise.all([
    query<{ d: string; n: string }>(
      `SELECT b.visit_date::text AS d, COUNT(*) AS n
       FROM ticketing.ticket_booking_guests g
       JOIN ticketing.ticket_bookings b ON b.id = g.booking_id
       WHERE b.branch_id = $1 AND b.company_id = $2
         AND b.visit_date BETWEEN $3::date AND $4::date
         AND b.status = ANY($5)
       GROUP BY b.visit_date`,
      [scope.branchId, scope.companyId, from, to, [...CAPACITY_HOLDING_BOOKING_STATUSES]]
    ),
    query<{ d: string; n: string }>(
      `SELECT (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date::text AS d,
              COUNT(*) AS n
       FROM ticketing.ticket_visit_bands vb
       JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
       WHERE v.branch_id = $1 AND v.company_id = $2
         AND v.status <> 'void'
         AND (v.opened_at AT TIME ZONE 'Asia/Jakarta')::date
             BETWEEN $3::date AND $4::date
         AND NOT EXISTS (
           SELECT 1 FROM ticketing.ticket_bookings bk WHERE bk.visit_id = v.id
         )
       GROUP BY 1`,
      [scope.branchId, scope.companyId, from, to]
    ),
  ]);
  const usedByDate = new Map<string, number>();
  for (const r of [...onlineRows, ...walkInRows]) {
    usedByDate.set(r.d, (usedByDate.get(r.d) ?? 0) + Number(r.n));
  }

  const result: Record<string, UnavailableKind> = {};
  for (let date = from; date <= to; date = addDaysIso(date, 1)) {
    const capacity = resolveDailyCapacity(date, venueDefault, overrideRows);
    if (capacity === null) continue;
    if (capacity === 0) result[date] = "closed";
    else if ((usedByDate.get(date) ?? 0) >= capacity) result[date] = "sold_out";
  }
  return result;
}

/** Error ber-statusCode 409 — pola staff-passes (route menerjemahkan). */
export class CapacityFullError extends Error {
  statusCode = 409 as const;
  constructor(message = "Kuota tanggal ini sudah penuh — pilih tanggal lain") {
    super(message);
    this.name = "CapacityFullError";
  }
}

/**
 * Guard lengkap: lock → resolve kapasitas → hitung okupansi → throw 409
 * bila `used + additional` melebihi. No-op cepat bila kuota tidak aktif
 * (unlimited) — TANPA lock, jalur existing bebas overhead.
 */
export async function assertCapacityAvailable(
  client: PoolClient,
  scope: VenueScope,
  date: string,
  additional: number
): Promise<void> {
  // Cek murah dulu tanpa lock: kuota non-aktif → tidak ada yang di-guard
  const capacityBefore = await loadEffectiveCapacity(client, scope, date);
  if (capacityBefore === null) return;

  await acquireCapacityLock(client, scope, date);
  // Resolve ULANG di bawah lock — config bisa berubah di antara dua bacaan
  const capacity = await loadEffectiveCapacity(client, scope, date);
  if (capacity === null) return;

  const used = await countCapacityUsed(client, scope, date);
  if (isCapacityExceeded(capacity, used, additional)) {
    throw new CapacityFullError(
      capacity === 0
        ? "Tanggal ini ditutup untuk kunjungan — pilih tanggal lain"
        : "Kuota tanggal ini sudah penuh — pilih tanggal lain"
    );
  }
}
