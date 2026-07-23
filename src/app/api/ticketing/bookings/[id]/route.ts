import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

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
  webhook_alert: string | null;
  created_at: string;
}

const idSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Loket boleh melihat rincian (bantu pengunjung); mutasi tetap admin
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
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
              used_at::text AS used_at, visit_id, refund_note, webhook_alert,
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

// PATCH melayani dua aksi kecil dashboard: simpan catatan refund manual
// dan/atau menutup alert webhook (anomali sudah ditindaklanjuti petugas).
const patchSchema = z
  .object({
    refund_note: z.string().trim().min(1).max(500).optional(),
    clear_webhook_alert: z.literal(true).optional(),
  })
  .refine(
    (body) => body.refund_note !== undefined || body.clear_webhook_alert,
    { message: "Tidak ada perubahan yang dikirim" }
  );

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
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Catatan refund wajib diisi (maks 500 karakter)" },
        { status: 400 }
      );
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [id, ctx.branchId, ctx.companyId];
    if (parsed.data.refund_note !== undefined) {
      values.push(parsed.data.refund_note);
      sets.push(`refund_note = $${values.length}`);
    }
    if (parsed.data.clear_webhook_alert) {
      sets.push("webhook_alert = NULL");
    }

    const updated = await queryOne<{ id: string }>(
      `UPDATE ticketing.ticket_bookings
       SET ${sets.join(", ")}
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
       RETURNING id`,
      values
    );
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Booking tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(
      { id: updated.id },
      parsed.data.clear_webhook_alert && parsed.data.refund_note === undefined
        ? "Alert ditandai selesai"
        : "Catatan refund tersimpan"
    );
  } catch (err) {
    console.error("[ticketing] booking refund note error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan catatan refund" },
      { status: 500 }
    );
  }
}
