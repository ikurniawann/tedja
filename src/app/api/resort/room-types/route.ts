import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { loadRoomTypes, loadSeasons, requireResortContext } from "@/lib/resort/server";

/**
 * GET  /api/resort/room-types — master tipe kamar + jumlah unit + musim tarif.
 * POST /api/resort/room-types — tambah tipe kamar.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireResortContext();
    const includeInactive = request.nextUrl.searchParams.get("all") === "1";
    const [types, seasons] = await Promise.all([
      loadRoomTypes(ctx.branchId, !includeInactive),
      loadSeasons(ctx.branchId),
    ]);
    return NextResponse.json({ success: true, data: { types, seasons } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] room-types GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

const schema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  zone: z.string().trim().max(60).optional().nullable(),
  capacity_adults: z.number().int().min(1).max(50).default(2),
  capacity_children: z.number().int().min(0).max(50).default(0),
  extra_bed_capacity: z.number().int().min(0).max(10).default(0),
  rate_weekday: z.number().min(0).default(0),
  rate_weekend: z.number().min(0).default(0),
  extra_bed_rate: z.number().min(0).default(0),
  amenities: z.array(z.string().trim().max(60)).max(30).default([]),
  sort_order: z.number().int().min(0).max(999).default(0),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireResortContext("create");
    const body = await validateBody(request, schema);
    const exists = await queryOne(
      `SELECT id FROM resort.room_types WHERE branch_id = $1 AND upper(code) = upper($2)`,
      [ctx.branchId, body.code]
    );
    if (exists) throw ApiError.conflict(`Kode tipe kamar "${body.code}" sudah dipakai`);
    const rows = await query(
      `INSERT INTO resort.room_types
         (company_id, branch_id, code, name, description, zone, capacity_adults, capacity_children,
          extra_bed_capacity, rate_weekday, rate_weekend, extra_bed_rate, amenities, sort_order, created_by)
       VALUES ($1, $2, upper($3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, code, name`,
      [ctx.companyId, ctx.branchId, body.code, body.name, body.description ?? null, body.zone ?? null,
       body.capacity_adults, body.capacity_children, body.extra_bed_capacity, body.rate_weekday,
       body.rate_weekend, body.extra_bed_rate, body.amenities, body.sort_order, ctx.user.id]
    );
    return NextResponse.json({ success: true, data: rows[0], message: `Tipe kamar ${body.name} dibuat` }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] room-types POST:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
