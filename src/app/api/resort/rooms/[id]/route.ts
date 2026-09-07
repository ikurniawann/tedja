import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireResortContext } from "@/lib/resort/server";

/**
 * PATCH  /api/resort/rooms/[id] — ubah kamar / status housekeeping.
 * DELETE /api/resort/rooms/[id] — hapus (nonaktifkan bila pernah ditempati).
 */
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  zone: z.string().trim().max(60).nullable().optional(),
  status: z.enum(["siap", "kotor", "perbaikan", "ditutup"]).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().optional(),
  room_type_id: z.string().uuid().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext("update");
    const { id } = await params;
    const body = await validateBody(request, patchSchema);
    const current = await queryOne(`SELECT id FROM resort.rooms WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]);
    if (!current) throw ApiError.notFound("Kamar tidak ditemukan");
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    const rows = await query(
      `UPDATE resort.rooms SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, code, name, status`,
      values
    );
    return NextResponse.json({ success: true, data: rows[0], message: "Kamar diperbarui" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] room PATCH:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext("delete");
    const { id } = await params;
    const current = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM resort.rooms WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]
    );
    if (!current) throw ApiError.notFound("Kamar tidak ditemukan");
    const used = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE room_id = $1`, [id]
    );
    if (Number(used?.c) > 0) {
      await query(`UPDATE resort.rooms SET is_active = false, status = 'ditutup', updated_at = now() WHERE id = $1`, [id]);
      return NextResponse.json({ success: true, message: `Kamar ${current.name} dinonaktifkan (punya riwayat menginap)` });
    }
    await query(`DELETE FROM resort.rooms WHERE id = $1`, [id]);
    return NextResponse.json({ success: true, message: `Kamar ${current.name} dihapus` });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] room DELETE:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
