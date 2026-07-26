import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requirePromoContext } from "@/lib/giftcard/server";

// EPIC-034 Fase A — nonaktifkan/aktifkan kembali satu gift card. Hanya
// bolak-balik antara `active` <-> `disabled`; kartu `pending`/`exhausted`/
// `expired` tidak bisa disentuh lewat toggle ini (siklus hidupnya beda).

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

    const current = await queryOne<{ status: string }>(
      `SELECT status FROM giftcard.gift_cards
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Gift card tidak ditemukan" },
        { status: 404 }
      );
    }
    if (current.status !== "active" && current.status !== "disabled") {
      return NextResponse.json(
        {
          success: false,
          error: `Gift card berstatus '${current.status}' tidak bisa diubah lewat aksi ini`,
        },
        { status: 409 }
      );
    }

    const nextStatus = parsed.data.is_active ? "active" : "disabled";
    const updated = await queryOne<{ id: string; status: string }>(
      `UPDATE giftcard.gift_cards
       SET status = $1, updated_at = now()
       WHERE id = $2 AND branch_id = $3 AND company_id = $4
       RETURNING id, status`,
      [nextStatus, id, ctx.branchId, ctx.companyId]
    );
    return successResponse(updated, "Gift card diperbarui");
  } catch (err) {
    console.error("[giftcard] update error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui gift card" },
      { status: 500 }
    );
  }
}
