import { NextResponse } from "next/server";
import { ApiError, requireIamAction, requireIamMenuPrefix, type ApiUser } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import type { RateSeason, RoomTypeRate } from "@/lib/resort/rates";
import { INVENTORY_BLOCKING_STATUSES } from "@/lib/resort/reservation";

/**
 * Konteks venue modul Resort — sama pola dengan Ticketing: scope bisnis user,
 * fallback default venue di CRM Settings supaya super admin (tanpa scope)
 * tetap bisa memakai modul.
 */

export interface ResortContext { user: ApiUser; companyId: string; branchId: string }

async function resolveVenue(): Promise<{ companyId: string | null; branchId: string | null }> {
  const scope = await getApiUserScope();
  let companyId = scope?.companyId ?? null;
  let branchId = scope?.branchId ?? null;
  if (companyId && branchId) return { companyId, branchId };
  const rows = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM crm.crm_settings WHERE key IN ('default_company_id', 'default_branch_id')`
  ).catch(() => []);
  for (const row of rows) {
    const value = typeof row.value === "string" ? row.value : String(row.value ?? "").replace(/"/g, "");
    if (!value) continue;
    if (row.key === "default_company_id" && !companyId) companyId = value;
    if (row.key === "default_branch_id" && !branchId) branchId = value;
  }
  return { companyId, branchId };
}

export function venueNotConfigured(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user" },
    { status: 409 }
  );
}

export async function requireResortContext(action?: "create" | "update" | "delete"): Promise<ResortContext> {
  const user = action
    ? await requireIamAction(IAM.resort, action)
    : await requireIamMenuPrefix(IAM.resort);
  const { companyId, branchId } = await resolveVenue();
  if (!companyId || !branchId) throw ApiError.conflict("Venue resort belum dikonfigurasi");
  return { user, companyId, branchId };
}

// ── Query bersama ──────────────────────────────────────────────────────────

export async function loadRoomTypes(branchId: string, onlyActive = true): Promise<(RoomTypeRate & Record<string, unknown>)[]> {
  return query(
    `SELECT t.id, t.code, t.name, t.description, t.zone, t.capacity_adults, t.capacity_children,
            t.extra_bed_capacity, t.rate_weekday::float8 AS rate_weekday, t.rate_weekend::float8 AS rate_weekend,
            t.extra_bed_rate::float8 AS extra_bed_rate, t.amenities, t.is_active, t.sort_order,
            (SELECT COUNT(*) FROM resort.rooms r WHERE r.room_type_id = t.id AND r.is_active)::int AS room_count
     FROM resort.room_types t
     WHERE t.branch_id = $1 ${onlyActive ? "AND t.is_active" : ""}
     ORDER BY t.sort_order, t.name`,
    [branchId]
  ) as Promise<(RoomTypeRate & Record<string, unknown>)[]>;
}

export async function loadSeasons(branchId: string, from?: string, to?: string): Promise<RateSeason[]> {
  const params: unknown[] = [branchId];
  let range = "";
  if (from && to) {
    params.push(from, to);
    range = ` AND start_date <= $3 AND end_date >= $2`;
  }
  return query<RateSeason>(
    `SELECT room_type_id, label, start_date::text AS start_date, end_date::text AS end_date,
            rate::float8 AS rate, surcharge_percent::float8 AS surcharge_percent
     FROM resort.rate_dates WHERE branch_id = $1 AND is_active${range}
     ORDER BY start_date`,
    params
  );
}

export interface BookedRow { room_type_id: string; room_id: string | null; check_in: string; check_out: string; reservation_id: string }

/** Kamar terpakai pada rentang tanggal (status yang masih memblokir stok). */
export async function loadBookedRooms(branchId: string, from: string, to: string, excludeReservationId?: string | null): Promise<BookedRow[]> {
  return query<BookedRow>(
    `SELECT rr.room_type_id, rr.room_id, r.check_in::text AS check_in, r.check_out::text AS check_out, r.id AS reservation_id
     FROM resort.reservation_rooms rr
     JOIN resort.reservations r ON r.id = rr.reservation_id
     WHERE r.branch_id = $1
       AND r.status = ANY($2::text[])
       AND r.check_in < $4::date AND r.check_out > $3::date
       AND ($5::uuid IS NULL OR r.id <> $5::uuid)`,
    [branchId, INVENTORY_BLOCKING_STATUSES, from, to, excludeReservationId ?? null]
  );
}

export interface FolioRow {
  id: string; charge_type: string; direction: "debit" | "kredit"; description: string;
  amount: number; payment_method: string | null; created_by_name: string | null; created_at: string;
}

export async function reservationDetail(branchId: string, id: string) {
  const reservation = await queryOne(
    `SELECT r.*, r.check_in::text AS check_in, r.check_out::text AS check_out,
            r.room_total::float8 AS room_total, r.extra_total::float8 AS extra_total,
            r.discount_amount::float8 AS discount_amount, r.total::float8 AS total
     FROM resort.reservations r WHERE r.branch_id = $1 AND r.id = $2`,
    [branchId, id]
  );
  if (!reservation) return null;
  const [rooms, folio] = await Promise.all([
    query(
      `SELECT rr.id, rr.room_type_id, rr.room_id, rr.room_type_name, rr.room_name, rr.guest_name,
              rr.nightly_rate::float8 AS nightly_rate, rr.nights, rr.extra_bed, rr.subtotal::float8 AS subtotal,
              rr.rate_breakdown, rm.code AS room_code, rm.status AS room_status
       FROM resort.reservation_rooms rr
       LEFT JOIN resort.rooms rm ON rm.id = rr.room_id
       WHERE rr.reservation_id = $1 ORDER BY rr.created_at`,
      [id]
    ),
    query<FolioRow>(
      `SELECT id, charge_type, direction, description, amount::float8 AS amount, payment_method,
              created_by_name, created_at
       FROM resort.folio_charges WHERE reservation_id = $1 ORDER BY created_at`,
      [id]
    ),
  ]);
  return { ...reservation, rooms, folio };
}
