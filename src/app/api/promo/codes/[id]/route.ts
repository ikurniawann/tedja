import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requirePromoContext } from "@/lib/promo/server";

// EPIC-032 A3 — toggle aktif satu kode. Nonaktif = kode berhenti diterima
// (riwayat redemptions tetap utuh); tidak ada hard delete kode — jejak
// voucher yang sudah tersebar harus awet.

const patchSchema = z.object({
  is_active: z.boolean(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const rows = await query<{ id: string }>(
      `UPDATE promo.promo_codes
       SET is_active = $1, updated_at = now()
       WHERE id = $2 AND branch_id = $3 AND company_id = $4
       RETURNING id`,
      [parsed.data.is_active, id, ctx.branchId, ctx.companyId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Kode tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(
      { id },
      parsed.data.is_active ? "Kode diaktifkan" : "Kode dinonaktifkan"
    );
  } catch (err) {
    console.error("[promo] toggle code error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui kode" },
      { status: 500 }
    );
  }
}
