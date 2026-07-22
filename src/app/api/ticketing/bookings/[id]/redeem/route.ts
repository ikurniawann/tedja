import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { BOOKING_MAX_QTY, matchRedeemGuests } from "@/lib/ticketing/booking";
import { todayJakartaDate } from "@/lib/ticketing/pricing-server";
import {
  TICKETING_OPERATOR_ROLES,
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// Fase D4 — redeem booking terbayar di loket: tiap ANGGOTA rombongan
// (ticket_booking_guests) di-pair tepat satu gelang NFC → buat visit
// PREPAID dgn charge tiket snapshot harga booking + baris pembayaran
// Xendit senilai sama (net 0 — revenue tiket kanal website tetap kebaca
// dari ledger). Nama anggota menempel ke gelang (visit_bands.guest_name).
// Idempotent: booking dikunci FOR UPDATE dan transisi terbayar→digunakan
// hanya bisa sekali; redeem ulang → 409.
// Gate tap TIDAK men-charge visit hasil booking (lihat gate/tap).

const redeemSchema = z.object({
  bands: z
    .array(
      z.object({
        nfc_uid: z.string().trim().min(1).max(80),
        guest_id: z.string().uuid(),
      })
    )
    .min(1)
    .max(BOOKING_MAX_QTY),
});

interface LockedBookingRow {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  total: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-booking-redeem:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak redeem — coba lagi sebentar" },
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
    const parsed = redeemSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const uids = body.bands.map((b) => normalizeNfcUid(b.nfc_uid));
    if (uids.some((uid) => !isValidNfcUid(uid))) {
      return NextResponse.json(
        { success: false, error: "Ada UID gelang yang tidak valid" },
        { status: 400 }
      );
    }
    if (new Set(uids).size !== uids.length) {
      return NextResponse.json(
        { success: false, error: "Ada gelang yang di-tap dua kali" },
        { status: 400 }
      );
    }

    const result = await withTransaction(async (client) => {
      // Kunci booking — serialisasi dgn redeem ganda & webhook
      const bookingResult = await client.query<LockedBookingRow>(
        `SELECT id, booking_code, visit_date::text AS visit_date,
                customer_name, customer_phone, status, total
         FROM ticketing.ticket_bookings
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      const booking = bookingResult.rows[0];
      if (!booking) {
        throw Object.assign(new Error("Booking tidak ditemukan di venue ini"), {
          statusCode: 404,
        });
      }
      if (booking.status === "digunakan") {
        throw Object.assign(
          new Error(`Booking ${booking.booking_code} SUDAH dipakai — tidak bisa dua kali`),
          { statusCode: 409 }
        );
      }
      if (booking.status !== "terbayar") {
        throw Object.assign(
          new Error(
            `Booking ${booking.booking_code} berstatus "${booking.status}" — hanya booking terbayar yang bisa di-redeem`
          ),
          { statusCode: 409 }
        );
      }
      const today = todayJakartaDate();
      if (booking.visit_date !== today) {
        throw Object.assign(
          new Error(
            `Booking untuk tanggal ${booking.visit_date} — hanya bisa dipakai pada hari-H (hari ini ${today})`
          ),
          { statusCode: 409 }
        );
      }

      // Anggota rombongan + snapshot harga dari item masing-masing
      const guestsResult = await client.query<{
        id: string;
        guest_name: string;
        position: number;
        variant_id: string;
        ticket_product_id: string;
        product_name: string;
        variant_name: string;
        unit_price: string;
        season_kind: string;
      }>(
        `SELECT g.id, g.guest_name, g.position, g.variant_id,
                i.ticket_product_id, i.product_name, i.variant_name,
                i.unit_price, i.season_kind
         FROM ticketing.ticket_booking_guests g
         JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
         WHERE g.booking_id = $1
         ORDER BY g.position`,
        [booking.id]
      );
      if (guestsResult.rows.length === 0) {
        throw Object.assign(
          new Error("Booking tanpa daftar anggota — hubungi supervisor"),
          { statusCode: 409 }
        );
      }
      const guestById = new Map(guestsResult.rows.map((g) => [g.id, g]));

      const match = matchRedeemGuests(
        guestsResult.rows.map((g) => g.id),
        body.bands
      );
      if (!match.ok) {
        const guest = match.guest_id ? guestById.get(match.guest_id) : null;
        throw Object.assign(
          new Error(
            match.reason === "guest-asing"
              ? "Ada gelang yang dipasangkan ke anggota di luar booking ini"
              : match.reason === "guest-dobel"
                ? `Anggota "${guest?.guest_name ?? "?"}" dipasangkan dua gelang`
                : `Anggota "${guest?.guest_name ?? "?"}" belum dapat gelang`
          ),
          { statusCode: 400 }
        );
      }

      // Kanal website visit — revenue per kanal terbaca benar di laporan
      const channelResult = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_channels
         WHERE branch_id = $1 AND company_id = $2
           AND is_online = true AND is_active = true
         ORDER BY sort_order LIMIT 1`,
        [ctx.branchId, ctx.companyId]
      );
      if (channelResult.rows.length === 0) {
        throw Object.assign(
          new Error("Kanal website tidak aktif — hubungi supervisor"),
          { statusCode: 400 }
        );
      }
      const channelId = channelResult.rows[0].id;

      // Kunci gelang deterministik (ORDER BY id — pola registrasi loket)
      const bandsResult = await client.query<{
        id: string;
        nfc_uid: string;
        status: string;
      }>(
        `SELECT id, nfc_uid, status FROM ticketing.ticket_bands
         WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = ANY($3)
         ORDER BY id
         FOR UPDATE`,
        [ctx.branchId, ctx.companyId, uids]
      );
      const bandByUid = new Map(bandsResult.rows.map((b) => [b.nfc_uid, b]));
      for (const uid of uids) {
        const band = bandByUid.get(uid);
        if (!band) {
          throw Object.assign(
            new Error(`Gelang ${uid} belum terdaftar di registry`),
            { statusCode: 400 }
          );
        }
        if (band.status !== "tersedia") {
          throw Object.assign(
            new Error(`Gelang ${uid} berstatus "${band.status}" — tidak bisa dipakai`),
            { statusCode: 409 }
          );
        }
      }

      // Visit prepaid tanpa plafon: tiket sudah lunas via Xendit
      const visitResult = await client.query<{ id: string }>(
        `INSERT INTO ticketing.ticket_visits
           (company_id, branch_id, contact_name, contact_phone, channel_id,
            payment_mode, credit_limit, created_by)
         VALUES ($1, $2, $3, $4, $5, 'prepaid', NULL, $6)
         RETURNING id`,
        [
          ctx.companyId,
          ctx.branchId,
          booking.customer_name,
          booking.customer_phone,
          channelId,
          ctx.user.id,
        ]
      );
      const visitId = visitResult.rows[0].id;

      // Ledger wajib net-0: Σ debit tiket harus = total booking (= kredit
      // pembayaran). Divergensi = data booking korup — gagal keras, jangan
      // tulis ledger pincang.
      const total = Number(booking.total);
      const debitSum = body.bands.reduce(
        (sum, b) => sum + Number(guestById.get(b.guest_id)!.unit_price),
        0
      );
      if (Math.abs(debitSum - total) > 0.01) {
        throw Object.assign(
          new Error(
            `Total booking (${total}) tidak cocok dengan jumlah harga tiket (${debitSum}) — hubungi supervisor`
          ),
          { statusCode: 409 }
        );
      }

      for (const input of body.bands) {
        const uid = normalizeNfcUid(input.nfc_uid);
        const band = bandByUid.get(uid)!;
        const item = guestById.get(input.guest_id)!;

        await client.query(
          `INSERT INTO ticketing.ticket_visit_bands
             (company_id, branch_id, visit_id, band_id, variant_id, guest_name)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ctx.companyId,
            ctx.branchId,
            visitId,
            band.id,
            item.variant_id,
            item.guest_name,
          ]
        );
        await client.query(
          `UPDATE ticketing.ticket_bands
           SET status = 'dipakai', updated_at = now()
           WHERE id = $1`,
          [band.id]
        );

        // amount > 0 saja (constraint ledger); tiket gratis = tanpa baris
        const unitPrice = Number(item.unit_price);
        if (unitPrice > 0) {
          await client.query(
            `INSERT INTO ticketing.ticket_visit_charges
               (company_id, branch_id, visit_id, band_id, charge_type, direction,
                description, amount, price_context, created_by)
             VALUES ($1, $2, $3, $4, 'tiket', 'debit', $5, $6, $7, $8)`,
            [
              ctx.companyId,
              ctx.branchId,
              visitId,
              band.id,
              `Tiket ${item.product_name} — ${item.variant_name} ` +
                `(${item.season_kind}, ${booking.visit_date}) — ` +
                `booking ${booking.booking_code}, a.n. ${item.guest_name}`,
              unitPrice,
              JSON.stringify({
                booking_id: booking.id,
                booking_guest_id: input.guest_id,
                ticket_product_id: item.ticket_product_id,
                variant_id: item.variant_id,
                season_kind: item.season_kind,
                channel_id: channelId,
                visit_date: booking.visit_date,
              }),
              ctx.user.id,
            ]
          );
        }
      }

      // Baris pembayaran senilai total booking → tab net 0
      if (total > 0) {
        await client.query(
          `INSERT INTO ticketing.ticket_visit_charges
             (company_id, branch_id, visit_id, charge_type, direction,
              description, amount, payment_method, created_by)
           VALUES ($1, $2, $3, 'pembayaran', 'kredit', $4, $5, 'xendit', $6)`,
          [
            ctx.companyId,
            ctx.branchId,
            visitId,
            `Pembayaran booking ${booking.booking_code} (Xendit, prepaid online)`,
            total,
            ctx.user.id,
          ]
        );
      }

      await client.query(
        `UPDATE ticketing.ticket_bookings
         SET status = 'digunakan', used_at = now(), visit_id = $2,
             updated_at = now()
         WHERE id = $1 AND status = 'terbayar'`,
        [booking.id, visitId]
      );

      return { visitId, bookingCode: booking.booking_code };
    });

    return successResponse(
      { visit_id: result.visitId },
      `Booking ${result.bookingCode} di-redeem — gelang siap dipakai`
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] booking redeem error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal me-redeem booking" },
      { status: 500 }
    );
  }
}
