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
