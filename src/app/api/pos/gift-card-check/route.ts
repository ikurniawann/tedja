import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { previewGiftCardForPos } from "@/lib/giftcard/giftcard-server";
import { isValidGiftCardCodeFormat } from "@/lib/giftcard/giftcard";
import { createPgClient } from "@/lib/pg/create-client";
import { checkRateLimit } from "@/lib/rate-limit";

// EPIC-034 Fase C — cek saldo gift card untuk kasir sebelum membayar.
// INDIKATIF: kebenaran final tetap ditegakkan saat debit ber-lock di rute
// order (pola promo-check EPIC-032). Auth = sesi kasir POS.
//
// Kode gift card = uang bagi pemegangnya, jadi endpoint ini dibatasi ketat:
// rate limit per kasir, hanya kode yang diketik PERSIS yang dicari (tanpa
// pencarian sebagian/daftar), dan balasan gagal tidak membedakan "kode tidak
// ada" dari "kode salah format" lebih jauh dari yang perlu.

const checkSchema = z.object({
  code: z.string().trim().min(3).max(40),
  total: z.number().min(0).max(1_000_000_000),
});

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  // Plafon lebih ketat dari promo-check: menebak kode bearer = menebak uang
  const rate = checkRateLimit(`pos-gift-card-check:${sessionUserId}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak percobaan — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = checkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed" },
        { status: 400 }
      );
    }
    const code = parsed.data.code.trim().toUpperCase();
    if (!isValidGiftCardCodeFormat(code)) {
      return NextResponse.json(
        { success: false, error: "Format kode gift card tidak valid" },
        { status: 400 }
      );
    }

    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.companyId || !venue.branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi" },
        { status: 400 }
      );
    }

    const preview = await previewGiftCardForPos({
      scope: { companyId: venue.companyId, branchId: venue.branchId },
      code,
      total: parsed.data.total,
    });
    if (!preview.ok) {
      // Percobaan gagal tetap dicatat — pola audit tab/gift card (uang).
      console.warn(
        `[pos] gift card check rejected: user=${sessionUserId} reason=${preview.reason}`
      );
    }
    return NextResponse.json({ success: true, data: preview });
  } catch (err) {
    console.error("[pos] gift card check error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memeriksa gift card" },
      { status: 500 }
    );
  }
}
