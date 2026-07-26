import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { previewPromoCode } from "@/lib/promo/promo-server";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";

// EPIC-032 B1 — endpoint PUBLIK validasi kode promo utk wizard booking.
// INDIKATIF (read-only tanpa klaim): kebenaran final tetap hold di dalam
// transaksi create. Subtotal dari klien hanya utk preview besar potongan —
// create menghitung ulang dari katalog server. Rate limit ketat
// (anti brute-force kode; pesan kode-tak-dikenal = nonaktif, anti-enumerasi).

const checkSchema = z.object({
  code: z.string().trim().min(3).max(40),
  subtotal: z.number().min(0).max(1_000_000_000),
  phone: z.string().trim().max(25).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`promo-check:${ip}`, { limit: 15, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak percobaan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { slug } = await params;
    const parsed = checkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed" },
        { status: 400 }
      );
    }
    const venue = await resolvePublicVenue(slug);
    if (!venue) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    const preview = await previewPromoCode({
      scope: { companyId: venue.companyId, branchId: venue.branchId },
      code: parsed.data.code,
      channel: "ticketing_online",
      subtotal: parsed.data.subtotal,
      phone: parsed.data.phone
        ? normalizePhoneDigits(parsed.data.phone)
        : null,
    });
    return successResponse(preview);
  } catch (err) {
    console.error("[booking] promo check error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memeriksa kode promo" },
      { status: 500 }
    );
  }
}
