import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";
import { buildAvailability } from "@/lib/ticketing/capacity-server";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";

// EPIC-031 B3 — endpoint PUBLIK (tanpa auth): peta tanggal tidak-tersedia
// utk kalender wizard. HANYA status penuh/tutup — TANPA angka sisa/kapasitas
// (keputusan owner 25 Jul). Tanggal tersedia diomit dari respons.
// Indikatif saja: kebenaran final tetap guard 409 di create booking.

const MAX_RANGE_DAYS = 92;

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000
  );

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`booking-availability:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { slug } = await params;
    const from = request.nextUrl.searchParams.get("from") ?? "";
    const to = request.nextUrl.searchParams.get("to") ?? "";
    if (!isValidCalendarDate(from) || !isValidCalendarDate(to) || to < from) {
      return NextResponse.json(
        { success: false, error: "Rentang tanggal tidak valid" },
        { status: 400 }
      );
    }
    if (daysBetween(from, to) > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { success: false, error: `Rentang maksimum ${MAX_RANGE_DAYS} hari` },
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

    const dates = await buildAvailability(
      { companyId: venue.companyId, branchId: venue.branchId },
      from,
      to
    );
    return successResponse({ dates });
  } catch (err) {
    console.error("[booking] availability error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat ketersediaan" },
      { status: 500 }
    );
  }
}
