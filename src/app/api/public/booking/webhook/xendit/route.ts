import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit, clientIpFrom } from "@/lib/public/rate-limit";
import { sendBookingPaidWa } from "@/lib/ticketing/booking-wa";
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

interface PaidBookingRow {
  id: string;
  booking_code: string;
  access_token: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  total: string;
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
        const expected = await queryOne<{ total: string }>(
          `SELECT total FROM ticketing.ticket_bookings WHERE id = $1::uuid`,
          [bookingId]
        );
        // Toleransi pembulatan 1 rupiah (invoice Xendit = rupiah bulat)
        if (expected && callback.amount < Math.floor(Number(expected.total))) {
          console.error(
            `[booking] webhook PAID nominal janggal: booking ${bookingId} ` +
              `total ${expected.total}, callback amount ${callback.amount} — diabaikan`
          );
          // Simpan sebagai alert — tampil di dashboard Booking sampai
          // petugas menandainya selesai (bukan cuma jejak di log server)
          await query(
            `UPDATE ticketing.ticket_bookings
             SET webhook_alert = $2, updated_at = now()
             WHERE id = $1::uuid`,
            [
              bookingId,
              `Xendit melapor PAID dengan nominal Rp${callback.amount.toLocaleString("id-ID")} — kurang dari total booking Rp${Number(expected.total).toLocaleString("id-ID")}. Pembayaran TIDAK ditandai lunas; periksa dashboard Xendit.`,
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
                   customer_name, customer_phone, total`,
        [bookingId, callback.paid_at ?? null, callback.id]
      );
      if (paid) {
        await sendBookingPaidWa(paid);
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
      await query(
        `UPDATE ticketing.ticket_bookings
         SET status = 'kedaluwarsa', updated_at = now()
         WHERE id = $1::uuid AND status = 'menunggu-bayar'`,
        [bookingId]
      );
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
