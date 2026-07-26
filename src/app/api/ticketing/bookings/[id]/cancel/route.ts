import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { releasePromoRedemption } from "@/lib/promo/promo-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireTicketingContext } from "@/lib/ticketing/server";

// Fase D5 — batalkan booking (keputusan manusia, bukan otomatis).
// Hanya menunggu-bayar / terbayar yang bisa dibatalkan (mesin status
// booking.ts); digunakan/kedaluwarsa/dibatalkan terminal. Pembatalan
// booking TERBAYAR wajib menyertakan catatan refund — uang sudah masuk,
// jejaknya tidak boleh kosong.

const cancelSchema = z.object({
  refund_note: z.string().trim().max(500).optional().nullable(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  const rate = checkRateLimit(`ticketing-booking-cancel:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak aksi — coba lagi sebentar" },
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
    const parsed = cancelSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const refundNote = parsed.data.refund_note?.trim() || null;

    const current = await queryOne<{ status: string; booking_code: string }>(
      `SELECT status, booking_code FROM ticketing.ticket_bookings
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Booking tidak ditemukan" },
        { status: 404 }
      );
    }
    if (current.status === "terbayar" && !refundNote) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Booking sudah terbayar — wajib isi catatan refund (uang dikembalikan di luar sistem)",
        },
        { status: 400 }
      );
    }

    // Transisi atomik: hanya dari status yang sah (race dgn webhook/redeem
    // aman — kalah race berarti 0 baris → 409, bukan status tertimpa)
    const cancelled = await queryOne<{ id: string }>(
      `UPDATE ticketing.ticket_bookings
       SET status = 'dibatalkan',
           refund_note = COALESCE($4, refund_note),
           updated_at = now()
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
         AND status IN ('menunggu-bayar', 'terbayar')
       RETURNING id`,
      [id, ctx.branchId, ctx.companyId, refundNote]
    );
    if (!cancelled) {
      return NextResponse.json(
        {
          success: false,
          error: `Booking ${current.booking_code} tidak bisa dibatalkan dari status sekarang`,
        },
        { status: 409 }
      );
    }
    // EPIC-032 B1 — batal melepas pemakaian promo (held ATAU captured);
    // best-effort idempoten
    await withTransaction((client) =>
      releasePromoRedemption(client, "ticket_booking", id)
    ).catch((err) => console.error("[ticketing] release promo error:", err));
    return successResponse(
      { id: cancelled.id },
      `Booking ${current.booking_code} dibatalkan`
    );
  } catch (err) {
    console.error("[ticketing] booking cancel error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membatalkan booking" },
      { status: 500 }
    );
  }
}
