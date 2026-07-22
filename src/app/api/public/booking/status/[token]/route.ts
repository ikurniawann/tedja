import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { expireBookingIfDue } from "@/lib/ticketing/booking-server";

// Endpoint PUBLIK: status booking via capability token (64 hex acak).
// Token salah/tak dikenal → 404 generik, tanpa membedakan "ada tapi
// bukan milikmu" (anti-enumerasi). QR di halaman status memuat
// booking_code — dipindai petugas loket saat redeem (Fase D4).

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

const notFound = () =>
  NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

interface BookingRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  status: string;
  total: string;
  xendit_invoice_url: string | null;
  expires_at: string | null;
  paid_at: string | null;
  used_at: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`booking-status:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { token } = await params;
    if (!TOKEN_PATTERN.test(token)) return notFound();

    const booking = await queryOne<BookingRow>(
      `SELECT id, booking_code, visit_date::text AS visit_date, customer_name,
              status, total, xendit_invoice_url,
              expires_at::text AS expires_at, paid_at::text AS paid_at,
              used_at::text AS used_at
       FROM ticketing.ticket_bookings
       WHERE access_token = $1`,
      [token]
    );
    if (!booking) return notFound();

    let status = booking.status;
    if (status === "menunggu-bayar" && (await expireBookingIfDue(booking.id))) {
      status = "kedaluwarsa";
    }

    const items = await query<{
      product_name: string;
      variant_name: string;
      qty: number;
      unit_price: string;
      season_kind: string;
      subtotal: string;
    }>(
      `SELECT product_name, variant_name, qty, unit_price, season_kind, subtotal
       FROM ticketing.ticket_booking_items
       WHERE booking_id = $1
       ORDER BY product_name, variant_name`,
      [booking.id]
    );

    return successResponse({
      booking_code: booking.booking_code,
      visit_date: booking.visit_date,
      customer_name: booking.customer_name,
      status,
      total: Number(booking.total),
      // Link bayar hanya relevan selama masih menunggu
      invoice_url: status === "menunggu-bayar" ? booking.xendit_invoice_url : null,
      expires_at: booking.expires_at,
      paid_at: booking.paid_at,
      used_at: booking.used_at,
      items: items.map((i) => ({
        product_name: i.product_name,
        variant_name: i.variant_name,
        qty: i.qty,
        unit_price: Number(i.unit_price),
        season_kind: i.season_kind,
        subtotal: Number(i.subtotal),
      })),
    });
  } catch (err) {
    console.error("[booking] status error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat status booking" },
      { status: 500 }
    );
  }
}
