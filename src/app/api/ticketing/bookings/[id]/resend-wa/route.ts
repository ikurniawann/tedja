import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendBookingPaidWa } from "@/lib/ticketing/booking-wa";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// Fase D5 — kirim ulang WA kode booking (pesan sama dgn webhook PAID).
// Hanya booking terbayar: menunggu-bayar belum punya hak masuk, status
// terminal tidak butuh QR lagi. Rate limit ketat — ini memicu pesan WA
// keluar ke pelanggan. Keputusan owner 2026-07-22: loket
// (pos/pos_supervisor) BOLEH kirim ulang — tidak berisiko uang, cuma
// mengirim ulang pesan yang sama ke nomor pemesan.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-booking-resend:${ctx.user.id}`, 10);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu sering kirim ulang — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json(
        { success: false, error: "Booking tidak dikenal" },
        { status: 404 }
      );
    }

    const booking = await queryOne<{
      booking_code: string;
      access_token: string;
      visit_date: string;
      customer_name: string;
      customer_phone: string;
      status: string;
      total: string;
    }>(
      `SELECT booking_code, access_token, visit_date::text AS visit_date,
              customer_name, customer_phone, status, total
       FROM ticketing.ticket_bookings
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!booking) {
      return NextResponse.json(
        { success: false, error: "Booking tidak ditemukan" },
        { status: 404 }
      );
    }
    if (booking.status !== "terbayar") {
      return NextResponse.json(
        {
          success: false,
          error: `Booking berstatus "${booking.status}" — hanya booking terbayar yang dikirimi ulang`,
        },
        { status: 409 }
      );
    }

    const sent = await sendBookingPaidWa(booking);
    if (!sent.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            sent.reason === "gateway-belum-dikonfigurasi"
              ? "WA gateway belum dikonfigurasi — cek Settings → WhatsApp Gateway"
              : "Gagal mengirim WA — cek koneksi gateway",
        },
        { status: 502 }
      );
    }
    return successResponse(
      { booking_code: booking.booking_code },
      `WA terkirim ulang ke ${booking.customer_phone}`
    );
  } catch (err) {
    console.error("[ticketing] booking resend WA error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim ulang WA" },
      { status: 500 }
    );
  }
}
