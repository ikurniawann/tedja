import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { eachNight, quoteStay, stayOverlaps, type RoomTypeRate } from "@/lib/resort/rates";
import { validateStayDates } from "@/lib/resort/reservation";
import { loadBookedRooms, loadRoomTypes, loadSeasons, requireResortContext } from "@/lib/resort/server";

/**
 * GET /api/resort/availability?check_in&check_out[&exclude_reservation_id]
 * Ketersediaan per tipe kamar untuk rentang menginap: jumlah unit, terpakai
 * per malam, sisa minimum sepanjang rentang, unit kamar yang bebas, dan
 * penawaran harga (rincian tarif per malam) untuk 1 kamar.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireResortContext();
    const sp = request.nextUrl.searchParams;
    const checkIn = String(sp.get("check_in") || "");
    const checkOut = String(sp.get("check_out") || "");
    const invalid = validateStayDates(checkIn, checkOut);
    if (invalid) throw ApiError.badRequest(invalid);
    const exclude = sp.get("exclude_reservation_id");

    const [types, seasons, booked, rooms] = await Promise.all([
      loadRoomTypes(ctx.branchId),
      loadSeasons(ctx.branchId, checkIn, checkOut),
      loadBookedRooms(ctx.branchId, checkIn, checkOut, exclude),
      query<{ id: string; code: string; name: string; room_type_id: string; status: string }>(
        `SELECT id, code, name, room_type_id, status FROM resort.rooms
         WHERE branch_id = $1 AND is_active AND status <> 'ditutup' ORDER BY code`,
        [ctx.branchId]
      ),
    ]);

    const nights = eachNight(checkIn, checkOut);
    const busyRoomIds = new Set(booked.map((b) => b.room_id).filter((id): id is string => Boolean(id)));

    const data = types.map((type) => {
      const typeId = String(type.id);
      const unitRooms = rooms.filter((r) => r.room_type_id === typeId);
      const bookedForType = booked.filter((b) => b.room_type_id === typeId);
      const perNight = nights.map((date) => {
        const used = bookedForType.filter((b) =>
          stayOverlaps({ check_in: date, check_out: date }, { check_in: b.check_in, check_out: b.check_out })
          || (date >= b.check_in && date < b.check_out)
        ).length;
        return { date, rooms: unitRooms.length, booked: used, available: Math.max(0, unitRooms.length - used) };
      });
      const quote = quoteStay({ type: type as unknown as RoomTypeRate, checkIn, checkOut, seasons });
      return {
        ...type,
        rooms_total: unitRooms.length,
        available: perNight.length ? Math.min(...perNight.map((n) => n.available)) : unitRooms.length,
        per_night: perNight,
        free_rooms: unitRooms.filter((r) => !busyRoomIds.has(r.id)).map(({ id, code, name, status }) => ({ id, code, name, status })),
        quote,
      };
    });

    return NextResponse.json({
      success: true,
      data: { check_in: checkIn, check_out: checkOut, nights: nights.length, types: data, seasons },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] availability:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
