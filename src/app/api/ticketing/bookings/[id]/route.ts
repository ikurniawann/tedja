import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireTicketingContext } from "@/lib/ticketing/server";

// Fase D5 — rincian booking utk dashboard + catatan refund manual.
// MVP: uang refund bergerak DI LUAR sistem (transfer manual); di sini
// hanya jejak catatannya supaya kasus "dibatalkan setelah bayar" tidak
// hilang tanpa dokumentasi.

interface BookingDetailRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  total: string;
  xendit_invoice_url: string | null;
  paid_at: string | null;
  expires_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  refund_note: string | null;
  created_at: string;
}

const idSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return NextResponse.json(
        { success: false, error: "Booking tidak dikenal" },
        { status: 404 }
      );
    }

    const booking = await queryOne<BookingDetailRow>(
      `SELECT id, booking_code, visit_date::text AS visit_date, customer_name,
              customer_phone, status, total, xendit_invoice_url,
              paid_at::text AS paid_at, expires_at::text AS expires_at,
              used_at::text AS used_at, visit_id, refund_note,
              created_at::text AS created_at
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

    const [items, guests] = await Promise.all([
      query<{
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
      ),
      query<{ guest_name: string; position: number; variant_name: string }>(
        `SELECT g.guest_name, g.position, i.variant_name
         FROM ticketing.ticket_booking_guests g
         JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
         WHERE g.booking_id = $1
         ORDER BY g.position`,
        [booking.id]
      ),
    ]);

    return successResponse({
      ...booking,
      total: Number(booking.total),
      items: items.map((i) => ({
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
    console.error("[ticketing] booking detail error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat rincian booking" },
      { status: 500 }
    );
  }
}

const refundNoteSchema = z.object({
  refund_note: z.string().trim().min(1).max(500),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  const rate = checkRateLimit(`ticketing-booking-refund-note:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak aksi — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    if (!idSchema.safeParse(id).success) {
      return NextResponse.json(
        { success: false, error: "Booking tidak dikenal" },
        { status: 404 }
      );
    }
    const parsed = refundNoteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Catatan refund wajib diisi (maks 500 karakter)" },
        { status: 400 }
      );
    }

    const updated = await queryOne<{ id: string }>(
      `UPDATE ticketing.ticket_bookings
       SET refund_note = $4, updated_at = now()
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
       RETURNING id`,
      [id, ctx.branchId, ctx.companyId, parsed.data.refund_note]
    );
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Booking tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse({ id: updated.id }, "Catatan refund tersimpan");
  } catch (err) {
    console.error("[ticketing] booking refund note error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan catatan refund" },
      { status: 500 }
    );
  }
}
