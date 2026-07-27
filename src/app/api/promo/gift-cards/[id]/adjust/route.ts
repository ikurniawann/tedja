import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { adjustGiftCardBalance } from "@/lib/giftcard/giftcard-server";
import { requirePromoContext } from "@/lib/giftcard/server";

// EPIC-034 Fase C — koreksi saldo manual ber-audit (keputusan owner 27 Jul).
// Order yang sudah `completed` tetap TIDAK bisa di-void (sama seperti cash /
// ark_coin), jadi kasus salah input di lapangan diperbaiki di sini: alasan
// WAJIB diisi dan tersimpan di ledger bersama identitas pelakunya.

const adjustSchema = z.object({
  // Bertanda: positif mengembalikan saldo, negatif menarik saldo
  delta: z
    .number()
    .refine((v) => Number.isFinite(v) && v !== 0, "Nominal koreksi tidak boleh 0")
    .refine((v) => Math.abs(v) <= 100_000_000, "Nominal koreksi terlalu besar"),
  reason: z.string().trim().min(5).max(300),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = adjustSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await adjustGiftCardBalance({
      scope: { companyId: ctx.companyId, branchId: ctx.branchId },
      cardId: id,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
      createdBy: ctx.user.id,
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.reason },
        { status: result.status }
      );
    }
    // Jejak audit di log server selain baris ledger
    console.warn(
      `[giftcard] koreksi saldo: card=${id} delta=${parsed.data.delta} by=${ctx.user.id}`
    );
    return successResponse(result, "Saldo gift card dikoreksi");
  } catch (err) {
    console.error("[giftcard] adjust error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengoreksi saldo gift card" },
      { status: 500 }
    );
  }
}
