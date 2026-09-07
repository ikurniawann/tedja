import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireResortContext } from "@/lib/resort/server";

/**
 * GET  /api/resort/rooms — unit kamar + status housekeeping + tamu yang menempati.
 * POST /api/resort/rooms — tambah unit kamar.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireResortContext();
    const typeId = request.nextUrl.searchParams.get("room_type_id");
    const params: unknown[] = [ctx.branchId];
    let filter = "";
    if (typeId) { params.push(typeId); filter = ` AND r.room_type_id = $${params.length}`; }
    const rooms = await query(
      `SELECT r.id, r.code, r.name, r.zone, r.status, r.notes, r.is_active,
              r.room_type_id, t.name AS room_type_name, t.code AS room_type_code,
              stay.reservation_id, stay.guest_name, stay.check_out::text AS occupied_until
       FROM resort.rooms r
       JOIN resort.room_types t ON t.id = r.room_type_id
       LEFT JOIN LATERAL (
         SELECT res.id AS reservation_id, res.guest_name, res.check_out
         FROM resort.reservation_rooms rr
         JOIN resort.reservations res ON res.id = rr.reservation_id
         WHERE rr.room_id = r.id AND res.status = 'check-in'
         ORDER BY res.check_in DESC LIMIT 1
       ) stay ON true
       WHERE r.branch_id = $1${filter}
       ORDER BY t.sort_order, t.name, r.code`,
      params
    );
    return NextResponse.json({ success: true, data: rooms });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] rooms GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

const schema = z.object({
  room_type_id: z.string().uuid(),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  zone: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireResortContext("create");
    const body = await validateBody(request, schema);
    const type = await queryOne(`SELECT id FROM resort.room_types WHERE id = $1 AND branch_id = $2`, [body.room_type_id, ctx.branchId]);
    if (!type) throw ApiError.notFound("Tipe kamar tidak ditemukan");
    const exists = await queryOne(`SELECT id FROM resort.rooms WHERE branch_id = $1 AND upper(code) = upper($2)`, [ctx.branchId, body.code]);
    if (exists) throw ApiError.conflict(`Kode kamar "${body.code}" sudah dipakai`);
    const rows = await query(
      `INSERT INTO resort.rooms (company_id, branch_id, room_type_id, code, name, zone, notes, created_by)
       VALUES ($1, $2, $3, upper($4), $5, $6, $7, $8) RETURNING id, code, name`,
      [ctx.companyId, ctx.branchId, body.room_type_id, body.code, body.name, body.zone ?? null, body.notes ?? null, ctx.user.id]
    );
    return NextResponse.json({ success: true, data: rows[0], message: `Kamar ${body.name} dibuat` }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] rooms POST:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
