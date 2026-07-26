import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  capturePromoRedemption,
  releasePromoRedemption,
} from "@/lib/promo/promo-server";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { sendBookingGiftWa, sendBookingPaidWa } from "@/lib/ticketing/booking-wa";
import { sendPassPaidWa } from "@/lib/ticketing/pass-wa";
import { todayInJakarta } from "@/lib/ticketing/booking";
import { addMonthsIso } from "@/lib/ticketing/season-pass";
import { isValidWebhookToken } from "@/lib/xendit/client";

// Webhook invoice Xendit (PAID/EXPIRED). Keamanan: verifikasi
// x-callback-token (401 bila salah/belum dikonfigurasi). Idempotent:
// transisi status pakai UPDATE ... WHERE status='menunggu-bayar' —
// callback ulang Xendit di-ACK 200 tanpa efek ganda (WA tidak terkirim
// dua kali). Kirim WA best-effort: gagal WA ≠ gagal webhook (Xendit
// akan retry dan bikin duplikat).

const callbackSchema = z.object({
  id: z.string(),
  external_id: z.string(),
  status: z.string(),
  paid_at: z.string().optional(),
  // Nominal callback dicek silang dgn total booking — token webhook bocor
  // saja tidak cukup untuk menandai lunas dgn nominal ngawur.
  amount: z.number().optional(),
});

const EXTERNAL_ID_PREFIX = "tkt-booking-";
const PASS_EXTERNAL_ID_PREFIX = "tkt-pass-";

interface PaidBookingRow {
  id: string;
  booking_code: string;
  access_token: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  total: string;
  discount_amount: string | null;
  gift_recipient_name: string | null;
  gift_recipient_phone: string | null;
}

export async function POST(request: NextRequest) {
  // Rem volumetrik kasar per IP — konsisten dgn endpoint publik lain;
  // longgar supaya burst retry Xendit yang sah tidak pernah kena.
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`booking-webhook:${ip}`, { limit: 120, windowMs: 60_000 })) {
    return NextResponse.json(
      { success: false, error: "Too many requests" },
      { status: 429 }
    );
  }

  if (!isValidWebhookToken(request.headers.get("x-callback-token"))) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const parsed = callbackSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Payload tidak dikenal" },
        { status: 400 }
      );
    }
    const callback = parsed.data;

    // EPIC-028 B2 — invoice Season Pass (prefix berbeda). Aktivasi pass:
    // valid_from = tanggal bayar (rolling), valid_until = + validity_months.
    if (callback.external_id.startsWith(PASS_EXTERNAL_ID_PREFIX)) {
      const passId = callback.external_id.slice(PASS_EXTERNAL_ID_PREFIX.length);
      if (!z.string().uuid().safeParse(passId).success) {
        return NextResponse.json({ success: true, ignored: true });
      }
      if (callback.status === "PAID" || callback.status === "SETTLED") {
        const info = await queryOne<{ validity_months: number; unit_price: string }>(
          `SELECT pc.validity_months, sp.unit_price
           FROM ticketing.ticket_season_passes sp
           JOIN ticketing.ticket_pass_configs pc
             ON pc.ticket_product_id = sp.ticket_product_id
           WHERE sp.id = $1::uuid`,
          [passId]
        );
        if (!info) return NextResponse.json({ success: true, ignored: true });
        if (
          callback.amount !== undefined &&
          callback.amount < Math.floor(Number(info.unit_price))
        ) {
          console.error(
            `[pass] webhook PAID nominal janggal: pass ${passId} harga ${info.unit_price}, ` +
              `callback ${callback.amount} — diabaikan`
          );
          return NextResponse.json({ success: true, ignored: true });
        }
        const today = todayInJakarta();
        const validUntil = addMonthsIso(today, info.validity_months);
        const activated = await queryOne<{
          pass_code: string;
          access_token: string;
          holder_name: string;
          holder_phone: string | null;
          valid_until: string;
        }>(
          `UPDATE ticketing.ticket_season_passes
           SET status = 'active', paid_at = COALESCE($2::timestamptz, now()),
               valid_from = $3, valid_until = $4, activated_at = now(),
               xendit_invoice_id = COALESCE(xendit_invoice_id, $5), updated_at = now()
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING pass_code, access_token, holder_name, holder_phone,
                     valid_until::text AS valid_until`,
          [passId, callback.paid_at ?? null, today, validUntil, callback.id]
        );
        if (activated) await sendPassPaidWa(activated);
        return NextResponse.json({ success: true });
      }
      if (callback.status === "EXPIRED") {
        await query(
          `UPDATE ticketing.ticket_season_passes
           SET status = 'cancelled', updated_at = now()
           WHERE id = $1::uuid AND status = 'pending'`,
          [passId]
        );
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ success: true, ignored: true });
    }

    if (!callback.external_id.startsWith(EXTERNAL_ID_PREFIX)) {
      // Callback produk lain (mis. topup nanti) — ACK saja, bukan error
      return NextResponse.json({ success: true, ignored: true });
    }
    const bookingId = callback.external_id.slice(EXTERNAL_ID_PREFIX.length);
    // external_id datang dari luar — uuid liar jangan sampai meledak jadi 500
    if (!z.string().uuid().safeParse(bookingId).success) {
      return NextResponse.json({ success: true, ignored: true });
    }

    if (callback.status === "PAID" || callback.status === "SETTLED") {
      // Cek silang nominal (bila Xendit mengirimnya): amount < total booking
      // → JANGAN tandai lunas; log utk investigasi manual. ACK 200 supaya
      // Xendit tidak retry callback yang memang kami tolak.
      if (callback.amount !== undefined) {
        const expected = await queryOne<{
          total: string;
          discount_amount: string;
        }>(
          `SELECT total, discount_amount
           FROM ticketing.ticket_bookings WHERE id = $1::uuid`,
          [bookingId]
        );
        // EPIC-032 B1: yang ditagih = total GROSS − potongan promo.
        // Toleransi pembulatan 1 rupiah (invoice Xendit = rupiah bulat)
        const expectedPayable = expected
          ? Number(expected.total) - Number(expected.discount_amount)
          : null;
        if (
          expected &&
          expectedPayable !== null &&
          callback.amount < Math.floor(expectedPayable)
        ) {
          console.error(
            `[booking] webhook PAID nominal janggal: booking ${bookingId} ` +
              `tagihan ${expectedPayable}, callback amount ${callback.amount} — diabaikan`
          );
          // Simpan sebagai alert — tampil di dashboard Booking sampai
          // petugas menandainya selesai (bukan cuma jejak di log server)
          await query(
            `UPDATE ticketing.ticket_bookings
             SET webhook_alert = $2, updated_at = now()
             WHERE id = $1::uuid`,
            [
              bookingId,
              `Xendit melapor PAID dengan nominal Rp${callback.amount.toLocaleString("id-ID")} — kurang dari tagihan booking Rp${expectedPayable.toLocaleString("id-ID")}. Pembayaran TIDAK ditandai lunas; periksa dashboard Xendit.`,
            ]
          );
          return NextResponse.json({ success: true, ignored: true });
        }
      }
      // Uang menang atas tebakan expiry: PAID juga membangkitkan booking
      // yang terlanjur di-lazy-expire (status page menyentuh row sesaat
      // sebelum webhook telat tiba). `dibatalkan` TIDAK dibangkitkan —
      // itu keputusan manusia; kasusnya di-log utk tindak lanjut manual.
      const paid = await queryOne<PaidBookingRow>(
        `UPDATE ticketing.ticket_bookings
         SET status = 'terbayar', paid_at = COALESCE($2::timestamptz, now()),
             xendit_invoice_id = COALESCE(xendit_invoice_id, $3),
             updated_at = now()
         WHERE id = $1::uuid AND status IN ('menunggu-bayar', 'kedaluwarsa')
         RETURNING id, booking_code, access_token, visit_date::text AS visit_date,
                   customer_name, customer_phone, total, discount_amount,
                   gift_recipient_name, gift_recipient_phone`,
        [bookingId, callback.paid_at ?? null, callback.id]
      );
      if (paid) {
        // EPIC-032 B1 — pemakaian promo jadi FINAL (held → captured);
        // idempoten, callback ulang tak menggandakan
        await withTransaction((client) =>
          capturePromoRedemption(client, "ticket_booking", bookingId)
        ).catch((err) =>
          console.error("[booking] capture promo error:", err)
        );
        await sendBookingPaidWa(paid);
        // EPIC-032 D2 — e-tiket hadiah ke penerima (best-effort)
        if (paid.gift_recipient_phone) {
          await sendBookingGiftWa(paid);
        }
      } else {
        // 0 baris = callback ulang yang sah (terbayar/digunakan) ATAU
        // pembayaran masuk utk booking dibatalkan — bedakan di log supaya
        // kasus butuh-refund tidak lenyap tanpa jejak.
        const current = await queryOne<{ status: string }>(
          `SELECT status FROM ticketing.ticket_bookings WHERE id = $1::uuid`,
          [bookingId]
        );
        if (current?.status === "dibatalkan") {
          console.error(
            `[booking] PAID diterima utk booking DIBATALKAN ${bookingId} — ` +
              `uang masuk tanpa tiket, perlu tindak lanjut manual/refund`
          );
          await query(
            `UPDATE ticketing.ticket_bookings
             SET webhook_alert = $2, updated_at = now()
             WHERE id = $1::uuid`,
            [
              bookingId,
              "Pembayaran Xendit MASUK untuk booking yang sudah DIBATALKAN — uang diterima tanpa tiket. Perlu refund manual; catat di Catatan Refund.",
            ]
          );
        }
      }
      return NextResponse.json({ success: true });
    }

    if (callback.status === "EXPIRED") {
      const expired = await query<{ id: string }>(
        `UPDATE ticketing.ticket_bookings
         SET status = 'kedaluwarsa', updated_at = now()
         WHERE id = $1::uuid AND status = 'menunggu-bayar'
         RETURNING id`,
        [bookingId]
      );
      // EPIC-032 B1 — lepas hold promo (jatah kode kembali); idempoten
      if (expired.length > 0) {
        await withTransaction((client) =>
          releasePromoRedemption(client, "ticket_booking", bookingId)
        ).catch((err) =>
          console.error("[booking] release promo error:", err)
        );
      }
      return NextResponse.json({ success: true });
    }

    // Status lain (PENDING dsb.) — ACK tanpa aksi
    return NextResponse.json({ success: true, ignored: true });
  } catch (err) {
    console.error("[booking] webhook error:", err);
    return NextResponse.json(
      { success: false, error: "Webhook gagal diproses" },
      { status: 500 }
    );
  }
}
