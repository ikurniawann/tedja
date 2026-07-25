import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { buildOccupancy } from "@/lib/ticketing/capacity-server";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// EPIC-031 Fase C — okupansi harian utk dashboard ops (kalender okupansi
// Booking, kartu laporan, peringatan pengaturan). Angka booked/capacity
// BOLEH tampil di sini (dashboard internal) — beda dari availability publik.

const MAX_RANGE_DAYS = 92;

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000
  );

export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
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

    const days = await buildOccupancy(
      { companyId: ctx.companyId, branchId: ctx.branchId },
      from,
      to
    );
    return successResponse({ days });
  } catch (err) {
    console.error("[ticketing] occupancy error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat okupansi" },
      { status: 500 }
    );
  }
}
