import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { wibDateString } from "@/lib/pos/report-period";
import { requireResortContext } from "@/lib/resort/server";

/**
 * GET /api/resort/front-office?date=YYYY-MM-DD — papan kerja harian:
 * kedatangan, keberangkatan, tamu menginap, okupansi, dan status kamar.
 */
const LIST_COLUMNS = `r.id, r.reservation_code, r.guest_name, r.guest_phone, r.status, r.source,
  r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights, r.adults, r.children,
  r.total::float8 AS total, r.special_request,
  (SELECT COUNT(*) FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id)::int AS room_count,
  (SELECT string_agg(COALESCE(rr.room_name, rr.room_type_name), ', ' ORDER BY rr.created_at)
     FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id) AS rooms_label,
  COALESCE((SELECT SUM(CASE WHEN f.direction = 'debit' THEN f.amount ELSE -f.amount END)
            FROM resort.folio_charges f WHERE f.reservation_id = r.id), 0)::float8 AS balance`;

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireResortContext();
    const raw = request.nextUrl.searchParams.get("date");
    const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : wibDateString(new Date());

    const [arrivals, departures, inHouse, rooms] = await Promise.all([
      query(
        `SELECT ${LIST_COLUMNS} FROM resort.reservations r
         WHERE r.branch_id = $1 AND r.check_in = $2::date
           AND r.status IN ('menunggu-bayar', 'terkonfirmasi')
         ORDER BY r.created_at`,
        [ctx.branchId, date]
      ),
      query(
        `SELECT ${LIST_COLUMNS} FROM resort.reservations r
         WHERE r.branch_id = $1 AND r.check_out = $2::date AND r.status = 'check-in'
         ORDER BY r.created_at`,
        [ctx.branchId, date]
      ),
      query(
        `SELECT ${LIST_COLUMNS} FROM resort.reservations r
         WHERE r.branch_id = $1 AND r.status = 'check-in'
         ORDER BY r.check_out, r.guest_name`,
        [ctx.branchId]
      ),
      query(
        `SELECT r.id, r.code, r.name, r.status, r.zone, t.name AS room_type_name,
                stay.guest_name, stay.check_out::text AS occupied_until
         FROM resort.rooms r
         JOIN resort.room_types t ON t.id = r.room_type_id
         LEFT JOIN LATERAL (
           SELECT res.guest_name, res.check_out FROM resort.reservation_rooms rr
           JOIN resort.reservations res ON res.id = rr.reservation_id
           WHERE rr.room_id = r.id AND res.status = 'check-in' LIMIT 1
         ) stay ON true
         WHERE r.branch_id = $1 AND r.is_active
         ORDER BY t.sort_order, t.name, r.code`,
        [ctx.branchId]
      ),
    ]);

    const occupied = rooms.filter((r) => (r as { guest_name?: string | null }).guest_name).length;
    return NextResponse.json({
      success: true,
      data: {
        date,
        arrivals,
        departures,
        in_house: inHouse,
        rooms,
        summary: {
          rooms_total: rooms.length,
          occupied,
          vacant: rooms.length - occupied,
          occupancy_pct: rooms.length ? Math.round((occupied / rooms.length) * 1000) / 10 : 0,
          arrivals: arrivals.length,
          departures: departures.length,
        },
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] front-office:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
