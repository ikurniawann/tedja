import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { folioTotals } from "@/lib/resort/reservation";
import { reservationDetail, requireResortContext } from "@/lib/resort/server";

/**
 * GET   /api/resort/reservations/[id] — detail + kamar + folio + saldo.
 * PATCH /api/resort/reservations/[id] — ubah catatan/permintaan khusus & kontak.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext();
    const { id } = await params;
    const detail = await reservationDetail(ctx.branchId, id);
    if (!detail) throw ApiError.notFound("Reservasi tidak ditemukan");
    return NextResponse.json({ success: true, data: { ...detail, totals: folioTotals(detail.folio) } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] reservation GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

const patchSchema = z.object({
  guest_name: z.string().trim().min(2).max(150).optional(),
  guest_phone: z.string().trim().min(6).max(30).optional(),
  guest_email: z.string().trim().email().max(150).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  special_request: z.string().trim().max(1000).nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext("update");
    const { id } = await params;
    const body = await validateBody(request, patchSchema);
    const sets: string[] = [];
    const values: unknown[] = [id, ctx.branchId];
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    if (sets.length === 0) return NextResponse.json({ success: true, data: { id } });
    const rows = await query(
      `UPDATE resort.reservations SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $1 AND branch_id = $2 RETURNING id, reservation_code`,
      values
    );
    if (rows.length === 0) throw ApiError.notFound("Reservasi tidak ditemukan");
    return NextResponse.json({ success: true, data: rows[0], message: "Reservasi diperbarui" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] reservation PATCH:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
