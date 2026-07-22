import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import {
  generateAccessToken,
  generateBookingCode,
  todayInJakarta,
  validateVisitDateWindow,
} from "@/lib/ticketing/booking";
import {
  buildPublicCatalog,
  resolvePublicVenue,
} from "@/lib/ticketing/booking-server";
import {
  createInvoice,
  getInvoiceExpiryHours,
  isXenditConfigured,
} from "@/lib/xendit/client";

// Endpoint PUBLIK: buat booking prepaid. Harga TIDAK diambil dari klien —
// dihitung ulang dari katalog server (varian tersembunyi/blok tidak bisa
// dibeli). Tanpa Xendit terkonfigurasi (atau mock) → 503 SEBELUM insert,
// supaya tidak ada booking yatim yang tak mungkin dibayar.

const MAX_QTY_PER_BOOKING = 20;

const createSchema = z.object({
  visit_date: z.string(),
  customer_name: z.string().trim().min(2).max(120),
  customer_phone: z.string().trim().min(8).max(25),
  items: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        qty: z.number().int().min(1).max(MAX_QTY_PER_BOOKING),
      })
    )
    .min(1)
    .max(10),
});

const notFound = () =>
  NextResponse.json({ success: false, error: "Not found" }, { status: 404 });

const badRequest = (error: string) =>
  NextResponse.json({ success: false, error }, { status: 400 });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`booking-create:${ip}`, { limit: 5, windowMs: 5 * 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak percobaan — coba lagi beberapa menit lagi" },
      { status: 429 }
    );
  }

  try {
    const { slug } = await params;
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const window = validateVisitDateWindow(body.visit_date, todayInJakarta());
    if (window !== "ok") {
      return badRequest(
        window === "masa-lalu"
          ? "Tanggal kunjungan sudah lewat"
          : window === "terlalu-jauh"
            ? "Tanggal kunjungan terlalu jauh ke depan"
            : "Tanggal kunjungan tidak valid"
      );
    }

    const phone = normalizePhoneDigits(body.customer_phone);
    if (!phone) return badRequest("Nomor WhatsApp tidak valid");

    const variantIds = body.items.map((i) => i.variant_id);
    if (new Set(variantIds).size !== variantIds.length) {
      return badRequest("Varian duplikat dalam pesanan");
    }
    const totalQty = body.items.reduce((sum, i) => sum + i.qty, 0);
    if (totalQty > MAX_QTY_PER_BOOKING) {
      return badRequest(`Maksimum ${MAX_QTY_PER_BOOKING} tiket per booking`);
    }

    if (!isXenditConfigured()) {
      return NextResponse.json(
        { success: false, error: "Pembayaran online belum tersedia — silakan beli di loket" },
        { status: 503 }
      );
    }

    const venue = await resolvePublicVenue(slug);
    if (!venue) return notFound();

    // Harga & kelayakan dihitung ulang server-side dari katalog tanggal itu
    const catalog = await buildPublicCatalog(venue, body.visit_date);
    const variantIndex = new Map(
      catalog.flatMap((p) =>
        p.variants.map((v) => [
          v.variant_id,
          {
            product_id: p.ticket_product_id,
            product_name: p.name,
            variant_name: v.variant_name,
            price: v.price,
            season_kind: v.season_kind,
          },
        ])
      )
    );

    interface PricedItem {
      variant_id: string;
      qty: number;
      product_id: string;
      product_name: string;
      variant_name: string;
      price: number;
      season_kind: string;
      subtotal: number;
    }
    const items: PricedItem[] = [];
    for (const item of body.items) {
      const known = variantIndex.get(item.variant_id);
      if (!known) {
        return badRequest(
          "Ada tiket yang tidak tersedia untuk tanggal ini — muat ulang halaman"
        );
      }
      items.push({
        ...item,
        ...known,
        // 2dp per baris — konvensi ledger Fase B, anti selisih float
        subtotal: Math.round(known.price * item.qty * 100) / 100,
      });
    }
    const total =
      Math.round(items.reduce((sum, i) => sum + i.subtotal, 0) * 100) / 100;
    // Invoice Xendit IDR wajib rupiah bulat; simpanan DB tetap total 2dp
    const invoiceAmount = Math.round(total);

    const accessToken = generateAccessToken();
    const expiresAt = new Date(
      Date.now() + getInvoiceExpiryHours() * 60 * 60 * 1000
    );

    // Insert dgn retry tabrakan booking_code (23505) — pola kode TKT R1
    let bookingId: string | null = null;
    let bookingCode = "";
    for (let attempt = 0; attempt < 3 && !bookingId; attempt++) {
      bookingCode = generateBookingCode();
      try {
        bookingId = await withTransaction(async (client) => {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO ticketing.ticket_bookings
               (company_id, branch_id, booking_code, access_token, visit_date,
                customer_name, customer_phone, status, total, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'menunggu-bayar',$8,$9)
             RETURNING id`,
            [
              venue.companyId,
              venue.branchId,
              bookingCode,
              accessToken,
              body.visit_date,
              body.customer_name,
              phone,
              total,
              expiresAt.toISOString(),
            ]
          );
          const id = inserted.rows[0].id;
          for (const item of items) {
            await client.query(
              `INSERT INTO ticketing.ticket_booking_items
                 (company_id, branch_id, booking_id, ticket_product_id,
                  variant_id, product_name, variant_name, qty, unit_price,
                  season_kind, subtotal)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [
                venue.companyId,
                venue.branchId,
                id,
                item.product_id,
                item.variant_id,
                item.product_name,
                item.variant_name,
                item.qty,
                item.price,
                item.season_kind,
                item.subtotal,
              ]
            );
          }
          return id;
        });
      } catch (err) {
        const pgCode = (err as { code?: string }).code;
        if (pgCode === "23505" && attempt < 2) continue; // kode tabrakan → coba lagi
        throw err;
      }
    }
    if (!bookingId) {
      throw new Error("Gagal mengalokasikan kode booking");
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
    const statusUrl = `${baseUrl}/booking/status/${accessToken}`;

    try {
      const invoice = await createInvoice({
        externalId: `tkt-booking-${bookingId}`,
        amount: invoiceAmount,
        payerName: body.customer_name,
        description: `Tiket ${bookingCode} — kunjungan ${body.visit_date}`,
        redirectUrl: statusUrl,
      });
      await query(
        `UPDATE ticketing.ticket_bookings
         SET xendit_invoice_id = $2, xendit_invoice_url = $3,
             expires_at = $4, updated_at = now()
         WHERE id = $1`,
        [
          bookingId,
          invoice.invoiceId,
          invoice.invoiceUrl,
          invoice.expiresAt.toISOString(),
        ]
      );
      return successResponse(
        {
          booking_code: bookingCode,
          access_token: accessToken,
          status_url: statusUrl,
          invoice_url: invoice.invoiceUrl,
          total,
          expires_at: invoice.expiresAt.toISOString(),
        },
        "Booking dibuat — selesaikan pembayaran"
      );
    } catch (invoiceErr) {
      // Invoice gagal → booking dibatalkan rapi, klien diberi tahu jelas
      console.error("[booking] invoice error:", invoiceErr);
      await query(
        `UPDATE ticketing.ticket_bookings
         SET status = 'dibatalkan', refund_note = 'pembuatan-invoice-gagal',
             updated_at = now()
         WHERE id = $1 AND status = 'menunggu-bayar'`,
        [bookingId]
      );
      return NextResponse.json(
        { success: false, error: "Pembayaran sedang gangguan — coba lagi" },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("[booking] create error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat booking" },
      { status: 500 }
    );
  }
}
