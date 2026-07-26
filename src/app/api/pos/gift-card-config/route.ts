import { NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { loadGiftCardConfig } from "@/lib/giftcard/giftcard-server";

// EPIC-034 Fase B — nominal preset & aturan nominal bebas untuk kasir.
// BACA SAJA: kasir tidak boleh mengubah konfigurasi (itu hak pengelola Promo
// lewat /api/promo/gift-card-config). Auth = sesi kasir POS, bukan peran
// dashboard — kasir memang perlu angka ini untuk menjual gift card.

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  try {
    const config = await loadGiftCardConfig();
    // expiry_months sengaja tidak dikirim: kasir tidak menentukan masa
    // berlaku, server yang menghitung saat kartu terbit.
    return NextResponse.json({
      success: true,
      data: { presets: config.presets, allow_custom: config.allow_custom },
    });
  } catch (err) {
    console.error("[pos] gift card config error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat konfigurasi gift card" },
      { status: 500 }
    );
  }
}
