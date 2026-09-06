import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireResortContext } from "@/lib/resort/server";

/**
 * PATCH  /api/resort/room-types/[id] — ubah tipe kamar (tarif, kapasitas, aktif).
 * DELETE /api/resort/room-types/[id] — nonaktifkan (soft) bila sudah pernah dipakai.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  zone: z.string().trim().max(60).nullable().optional(),
  capacity_adults: z.number().int().min(1).max(50).optional(),
  capacity_children: z.number().int().min(0).max(50).optional(),
  extra_bed_capacity: z.number().int().min(0).max(10).optional(),
  rate_weekday: z.number().min(0).optional(),
  rate_weekend: z.number().min(0).optional(),
  extra_bed_rate: z.number().min(0).optional(),
  amenities: z.array(z.string().trim().max(60)).max(30).optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext("update");
    const { id } = await params;
    const body = await validateBody(request, patchSchema);
    const current = await queryOne(`SELECT id FROM resort.room_types WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]);
    if (!current) throw ApiError.notFound("Tipe kamar tidak ditemukan");

    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    const rows = await query(
      `UPDATE resort.room_types SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, code, name`,
      values
    );
    return NextResponse.json({ success: true, data: rows[0], message: "Tipe kamar diperbarui" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] room-type PATCH:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext("delete");
    const { id } = await params;
    const current = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM resort.room_types WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]
    );
    if (!current) throw ApiError.notFound("Tipe kamar tidak ditemukan");
    const used = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE room_type_id = $1`, [id]
    );
    if (Number(used?.c) > 0) {
      await query(`UPDATE resort.room_types SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
      return NextResponse.json({
        success: true,
        message: `Tipe kamar ${current.name} dinonaktifkan (sudah dipakai reservasi, riwayat dipertahankan)`,
      });
    }
    await query(`DELETE FROM resort.room_types WHERE id = $1`, [id]);
    return NextResponse.json({ success: true, message: `Tipe kamar ${current.name} dihapus` });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] room-type DELETE:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
