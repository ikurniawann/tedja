import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import {
  loadGiftCardConfig,
  saveGiftCardConfig,
} from "@/lib/giftcard/giftcard-server";
import { MAX_GIFT_CARD_VALUE } from "@/lib/giftcard/giftcard";
import { requirePromoContext } from "@/lib/giftcard/server";

// EPIC-034 Fase B — konfigurasi nominal & masa berlaku gift card (keputusan
// owner #4: configurable, bukan hardcode). Guard = peran pengelola Promo
// (super_admin + marketing), sama dgn tab Gift Card yang menampungnya.

export async function GET() {
  const { error } = await requirePromoContext();
  if (error) return error;
  try {
    return successResponse(await loadGiftCardConfig());
  } catch (err) {
    console.error("[giftcard] config get error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat konfigurasi gift card" },
      { status: 500 }
    );
  }
}

const putSchema = z.object({
  presets: z
    .array(z.number().int().positive().max(MAX_GIFT_CARD_VALUE))
    .min(1)
    .max(12)
    .optional(),
  allow_custom: z.boolean().optional(),
  expiry_months: z.number().int().min(1).max(120).nullable().optional(),
});

export async function PUT(request: NextRequest) {
  const { error } = await requirePromoContext();
  if (error) return error;
  try {
    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const saved = await saveGiftCardConfig(parsed.data);
    return successResponse(saved, "Konfigurasi gift card tersimpan");
  } catch (err) {
    console.error("[giftcard] config put error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan konfigurasi gift card" },
      { status: 500 }
    );
  }
}
