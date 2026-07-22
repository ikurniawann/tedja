// Fase D — Website Booking: helper murni booking online (status machine,
// kode booking, capability token, jendela tanggal). Tanpa DB supaya mudah
// diuji; pemakaian di route API publik /api/public/booking/*.

import { randomBytes, randomInt } from "crypto";
import { isValidCalendarDate } from "./pricing";

export const BOOKING_STATUSES = [
  "menunggu-bayar",
  "terbayar",
  "digunakan",
  "kedaluwarsa",
  "dibatalkan",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// menunggu-bayar → terbayar (webhook PAID) | kedaluwarsa (invoice expired)
//                → dibatalkan (admin); terbayar → digunakan (redeem loket)
//                → dibatalkan (refund manual). Terminal: tiga sisanya.
const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  "menunggu-bayar": ["terbayar", "kedaluwarsa", "dibatalkan"],
  terbayar: ["digunakan", "dibatalkan"],
  digunakan: [],
  kedaluwarsa: [],
  dibatalkan: [],
};

export function canTransitionBooking(
  from: BookingStatus,
  to: BookingStatus
): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

// Charset tanpa 0/O/1/I/L — kode dibacakan lewat telepon/WA dan diketik
// petugas loket; salah baca huruf ambigu = antrian tertahan.
const BOOKING_CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BOOKING_CODE_LENGTH = 6;

const BOOKING_CODE_PATTERN = /^BK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/**
 * Normalisasi input petugas loket (ketik manual / hasil scan QR):
 * huruf besar, spasi dibuang, prefix BK- boleh tertinggal. Null bila
 * hasilnya tetap bukan kode booking yang sah.
 */
export function normalizeBookingCode(raw: string): string | null {
  let code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!code.startsWith("BK-")) {
    code = code.startsWith("BK") ? `BK-${code.slice(2)}` : `BK-${code}`;
  }
  return BOOKING_CODE_PATTERN.test(code) ? code : null;
}

/** Kode pendek human-friendly (BK-XXXXXX); tabrakan ditangani retry 23505. */
export function generateBookingCode(): string {
  let suffix = "";
  for (let i = 0; i < BOOKING_CODE_LENGTH; i++) {
    suffix += BOOKING_CODE_CHARSET[randomInt(BOOKING_CODE_CHARSET.length)];
  }
  return `BK-${suffix}`;
}

/** Capability token halaman status publik — 32 byte acak, hex. */
export function generateAccessToken(): string {
  return randomBytes(32).toString("hex");
}

export const BOOKING_MAX_DAYS_AHEAD = 90;

export type VisitDateWindowResult =
  | "ok"
  | "masa-lalu"
  | "terlalu-jauh"
  | "tidak-valid";

const addDays = (isoDate: string, days: number): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

/** Jendela booking: hari ini s/d +BOOKING_MAX_DAYS_AHEAD (inklusif). */
export function validateVisitDateWindow(
  visitDate: string,
  today: string
): VisitDateWindowResult {
  if (!isValidCalendarDate(visitDate)) return "tidak-valid";
  if (visitDate < today) return "masa-lalu";
  if (visitDate > addDays(today, BOOKING_MAX_DAYS_AHEAD)) return "terlalu-jauh";
  return "ok";
}

/** Tanggal hari ini menurut zona venue (WIB) — bukan UTC server. */
export function todayInJakarta(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// ── Redeem loket (Fase D4) ────────────────────────────────────────────
// Booking terbayar ditukar gelang di loket: jumlah gelang per varian
// HARUS persis sama dengan qty item booking — kurang/lebih/varian asing
// semuanya ditolak supaya tiket yang dibayar = tiket yang dipakai.

export interface RedeemItemNeed {
  variant_id: string;
  qty: number;
}

export type MatchRedeemBandsResult =
  | { ok: true }
  | {
      ok: false;
      reason: "varian-asing" | "jumlah-tak-cocok";
      variant_id: string;
      expected: number;
      actual: number;
    };

/** Cocokkan gelang yang di-tap dengan kebutuhan item booking (per varian). */
export function matchRedeemBands(
  items: readonly RedeemItemNeed[],
  bands: readonly { variant_id: string }[]
): MatchRedeemBandsResult {
  const need = new Map<string, number>();
  for (const item of items) {
    need.set(item.variant_id, (need.get(item.variant_id) ?? 0) + item.qty);
  }

  const got = new Map<string, number>();
  for (const band of bands) {
    if (!need.has(band.variant_id)) {
      return {
        ok: false,
        reason: "varian-asing",
        variant_id: band.variant_id,
        expected: 0,
        actual: (got.get(band.variant_id) ?? 0) + 1,
      };
    }
    got.set(band.variant_id, (got.get(band.variant_id) ?? 0) + 1);
  }

  for (const [variantId, expected] of need) {
    const actual = got.get(variantId) ?? 0;
    if (actual !== expected) {
      return {
        ok: false,
        reason: "jumlah-tak-cocok",
        variant_id: variantId,
        expected,
        actual,
      };
    }
  }
  return { ok: true };
}
