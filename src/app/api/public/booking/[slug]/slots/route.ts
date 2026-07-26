import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import {
  todayInJakarta,
  validateVisitDateWindow,
} from "@/lib/ticketing/booking";
import { resolvePublicVenue } from "@/lib/ticketing/booking-server";
import {
  countSlotUsedByDate,
  loadActiveSlots,
} from "@/lib/ticketing/capacity-server";

// EPIC-031 Fase D — endpoint PUBLIK: slot waktu venue utk satu tanggal.
// Kosong = venue tanpa timed-entry (wizard tanpa langkah slot). Status
// per slot hanya available|sold_out — TANPA angka (konsisten availability).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`booking-slots:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { slug } = await params;
    const date = request.nextUrl.searchParams.get("date") ?? "";
    if (validateVisitDateWindow(date, todayInJakarta()) !== "ok") {
      return NextResponse.json(
        { success: false, error: "Tanggal tidak valid" },
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

    const scope = { companyId: venue.companyId, branchId: venue.branchId };
    const slots = await loadActiveSlots(scope);
    if (slots.length === 0) return successResponse({ slots: [] });

    const usedBySlot = await countSlotUsedByDate(scope, date);
    return successResponse({
      slots: slots.map((slot) => ({
        slot_id: slot.id,
        label: slot.label,
        start_time: slot.start_time.slice(0, 5),
        end_time: slot.end_time.slice(0, 5),
        status:
          slot.capacity !== null &&
          (usedBySlot.get(slot.id) ?? 0) >= slot.capacity
            ? "sold_out"
            : "available",
      })),
    });
  } catch (err) {
    console.error("[booking] slots error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat slot waktu" },
      { status: 500 }
    );
  }
}
