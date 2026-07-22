import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  isForfeitDue,
  normalizeBookingCode,
  redeemWindowStatus,
} from "@/lib/ticketing/booking";
import { expireBookingIfDue } from "@/lib/ticketing/booking-server";
import { todayJakartaDate } from "@/lib/ticketing/pricing-server";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// Fase D4 — loket mencari booking dari kode (scan QR status page / ketik
// manual). Hanya venue sendiri (booking_code unik per branch); lookup
// tidak mengubah status kecuali lazy expiry menunggu-bayar yang basi.

interface BookingLookupRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  total: string;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
}

export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-booking-lookup:${ctx.user.id}`, 60);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pencarian — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const code = normalizeBookingCode(request.nextUrl.searchParams.get("code") ?? "");
    if (!code) {
      return NextResponse.json(
        { success: false, error: "Kode booking tidak valid (format BK-XXXXXX)" },
        { status: 400 }
      );
    }

    const booking = await queryOne<BookingLookupRow>(
      `SELECT id, booking_code, visit_date::text AS visit_date, customer_name,
              customer_phone, status, total, paid_at::text AS paid_at,
              used_at::text AS used_at, visit_id
       FROM ticketing.ticket_bookings
       WHERE branch_id = $1 AND company_id = $2 AND booking_code = $3`,
      [ctx.branchId, ctx.companyId, code]
    );
    if (!booking) {
      return NextResponse.json(
        { success: false, error: `Booking ${code} tidak ditemukan di venue ini` },
        { status: 404 }
      );
    }

    let status = booking.status;
    if (status === "menunggu-bayar" && (await expireBookingIfDue(booking.id))) {
      status = "kedaluwarsa";
    }

    // Kebijakan hangus venue (keputusan owner 2026-07-23): masa berlaku
    // redeem = hari-H + N hari; NULL = hanya hari-H, tanpa hangus.
    const settingsRow = await queryOne<{ booking_forfeit_days: number | null }>(
      `SELECT booking_forfeit_days FROM ticketing.ticket_settings
       WHERE branch_id = $1 AND company_id = $2`,
      [ctx.branchId, ctx.companyId]
    );
    const forfeitDays = settingsRow?.booking_forfeit_days ?? null;
    const today = todayJakartaDate();

    // Lazy forfeit — loket melihat kebenaran terkini walau watcher belum
    // sempat lewat; UPDATE-WHERE-status idempotent (pola lazy expiry).
    if (status === "terbayar" && isForfeitDue(booking.visit_date, today, forfeitDays)) {
      const forfeited = await queryOne<{ id: string }>(
        `UPDATE ticketing.ticket_bookings
         SET status = 'hangus', forfeited_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'terbayar' AND visit_id IS NULL
         RETURNING id`,
        [booking.id]
      );
      if (forfeited) status = "hangus";
    }

    const [items, guests] = await Promise.all([
      query<{
        variant_id: string;
        ticket_product_id: string;
        product_name: string;
        variant_name: string;
        qty: number;
        unit_price: string;
        season_kind: string;
        subtotal: string;
      }>(
        `SELECT variant_id, ticket_product_id, product_name, variant_name,
                qty, unit_price, season_kind, subtotal
         FROM ticketing.ticket_booking_items
         WHERE booking_id = $1
         ORDER BY product_name, variant_name`,
        [booking.id]
      ),
      // Anggota rombongan — bekal pairing gelang per orang di dialog redeem
      query<{
        id: string;
        guest_name: string;
        position: number;
        variant_id: string;
        product_name: string;
        variant_name: string;
      }>(
        `SELECT g.id, g.guest_name, g.position, g.variant_id,
                i.product_name, i.variant_name
         FROM ticketing.ticket_booking_guests g
         JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
         WHERE g.booking_id = $1
         ORDER BY g.position`,
        [booking.id]
      ),
    ]);

    return successResponse({
      id: booking.id,
      booking_code: booking.booking_code,
      visit_date: booking.visit_date,
      customer_name: booking.customer_name,
      customer_phone: booking.customer_phone,
      status,
      total: Number(booking.total),
      paid_at: booking.paid_at,
      used_at: booking.used_at,
      visit_id: booking.visit_id,
      // UI menampilkan alasan tanpa menebak ulang aturan server
      redeemable:
        status === "terbayar" &&
        redeemWindowStatus(booking.visit_date, today, forfeitDays) === "boleh",
      today,
      items: items.map((i) => ({
        variant_id: i.variant_id,
        ticket_product_id: i.ticket_product_id,
        product_name: i.product_name,
        variant_name: i.variant_name,
        qty: i.qty,
        unit_price: Number(i.unit_price),
        season_kind: i.season_kind,
        subtotal: Number(i.subtotal),
      })),
      guests,
    });
  } catch (err) {
    console.error("[ticketing] booking lookup error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencari booking" },
      { status: 500 }
    );
  }
}
