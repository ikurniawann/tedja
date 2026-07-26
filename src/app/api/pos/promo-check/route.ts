import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { previewPromoCode } from "@/lib/promo/promo-server";
import { checkRateLimit } from "@/lib/rate-limit";

// EPIC-032 C1 — validasi kode promo utk kasir (channel 'pos'). INDIKATIF:
// kebenaran final tetap hold server-side saat order dibuat (422 bila
// keburu habis). Auth = sesi kasir POS.

const checkSchema = z.object({
  code: z.string().trim().min(3).max(40),
  subtotal: z.number().min(0).max(1_000_000_000),
});

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }
  const rate = checkRateLimit(`pos-promo-check:${sessionUserId}`, 30);
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
    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.companyId || !venue.branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi" },
        { status: 400 }
      );
    }
    const preview = await previewPromoCode({
      scope: { companyId: venue.companyId, branchId: venue.branchId },
      code: parsed.data.code,
      channel: "pos",
      subtotal: parsed.data.subtotal,
      phone: null,
    });
    return NextResponse.json({ success: true, data: preview });
  } catch (err) {
    console.error("[pos] promo check error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memeriksa kode promo" },
      { status: 500 }
    );
  }
}
