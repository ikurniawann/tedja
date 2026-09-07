import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { canBypassOtp } from "@/lib/member-portal/dev-bypass";
import {
  hashSecret,
  normalizePhoneDigits,
  OTP_MAX_ATTEMPTS,
} from "@/lib/member-portal/otp";
import {
  createMemberSession,
  MEMBER_SESSION_COOKIE,
  memberSessionCookieOptions,
} from "@/lib/member-portal/session";

/**
 * POST /api/member-portal/verify { phone, code } — verifikasi OTP →
 * buat sesi member (cookie member_session) + stempel wa_verified_at.
 *
 * EPIC-044 (mobile app): klien app mengirim header `x-app-client: 1` →
 * token sesi juga dikembalikan di body JSON untuk disimpan di SecureStore
 * (cookie httpOnly tidak berguna bagi klien native). Portal web TIDAK mengirim
 * header itu dan tetap menerima jawaban lama tanpa token di body.
 */
export async function POST(request: NextRequest) {
  const appClient = request.headers.get("x-app-client") === "1";
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizePhoneDigits(body.phone);
    const code = String(body.code ?? "").trim();

    /* Bypass dev lokal (lihat lib/member-portal/dev-bypass): melewati
     * pemeriksaan record OTP — kode boleh kosong. TIDAK melewati pencarian
     * member: nomor yang bukan member tetap ditolak. Mati total di produksi.
     * Dievaluasi sebelum validasi format karena kode kosong itu sah di sini. */
    const devBypass = canBypassOtp(code);

    if (!phone || (!devBypass && !/^\d{6}$/.test(code))) {
      return NextResponse.json(
        { success: false, error: "Nomor/kode tidak valid" },
        { status: 400 }
      );
    }

    const pool = getPool();

    if (devBypass) {
      console.warn(`[member-portal] OTP dev bypass dipakai untuk ${phone}`);
    }

    const { rows: otps } = devBypass
      ? { rows: [] as Array<Record<string, unknown>> }
      : await pool.query(
          `SELECT id, code_hash, attempts, expires_at, consumed_at
       FROM crm.member_portal_otp
       WHERE phone = $1
       ORDER BY created_at DESC LIMIT 1`,
          [phone]
        );
    const otp = otps[0];
    if (!devBypass && (!otp || otp.consumed_at || new Date(otp.expires_at) < new Date())) {
      return NextResponse.json(
        { success: false, error: "Kode kedaluwarsa — minta kode baru" },
        { status: 400 }
      );
    }
    if (!devBypass && otp.attempts >= OTP_MAX_ATTEMPTS) {
      return NextResponse.json(
        { success: false, error: "Terlalu banyak percobaan — minta kode baru" },
        { status: 429 }
      );
    }

    if (!devBypass && otp.code_hash !== hashSecret(code)) {
      await pool.query(
        `UPDATE crm.member_portal_otp SET attempts = attempts + 1 WHERE id = $1`,
        [otp.id]
      );
      return NextResponse.json(
        { success: false, error: "Kode salah" },
        { status: 400 }
      );
    }

    // Kode benar → konsumsi + temukan member + stempel verifikasi WA
    const { rows: customers } = await pool.query(
      `SELECT id, name FROM pos.pos_customers
       WHERE is_active IS NOT FALSE
         AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g')
             IN ($1, '0' || substring($1 from 3))
       LIMIT 1`,
      [phone]
    );
    if (customers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Member tidak ditemukan" },
        { status: 404 }
      );
    }

    if (!devBypass) {
      await pool.query(
        `UPDATE crm.member_portal_otp SET consumed_at = now() WHERE id = $1`,
        [otp.id]
      );
    }
    await pool.query(
      `UPDATE pos.pos_customers
       SET wa_verified_at = COALESCE(wa_verified_at, now()), updated_at = now()
       WHERE id = $1`,
      [customers[0].id]
    );

    const token = await createMemberSession(customers[0].id);
    const response = NextResponse.json({
      success: true,
      data: {
        name: customers[0].name,
        ...(appClient ? { token } : {}),
      },
    });
    response.cookies.set(MEMBER_SESSION_COOKIE, token, memberSessionCookieOptions(request));
    return response;
  } catch (error) {
    console.error("Error verifying member OTP:", error);
    return NextResponse.json(
      { success: false, error: "Gagal verifikasi OTP" },
      { status: 500 }
    );
  }
}
