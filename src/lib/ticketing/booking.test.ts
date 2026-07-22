import { describe, expect, test } from "vitest";
import {
  BOOKING_MAX_DAYS_AHEAD,
  canTransitionBooking,
  generateAccessToken,
  generateBookingCode,
  validateVisitDateWindow,
} from "./booking";

describe("canTransitionBooking (mesin status booking)", () => {
  test("menunggu-bayar boleh ke terbayar / kedaluwarsa / dibatalkan", () => {
    expect(canTransitionBooking("menunggu-bayar", "terbayar")).toBe(true);
    expect(canTransitionBooking("menunggu-bayar", "kedaluwarsa")).toBe(true);
    expect(canTransitionBooking("menunggu-bayar", "dibatalkan")).toBe(true);
  });

  test("terbayar hanya boleh ke digunakan / dibatalkan", () => {
    expect(canTransitionBooking("terbayar", "digunakan")).toBe(true);
    expect(canTransitionBooking("terbayar", "dibatalkan")).toBe(true);
    expect(canTransitionBooking("terbayar", "kedaluwarsa")).toBe(false);
    expect(canTransitionBooking("terbayar", "menunggu-bayar")).toBe(false);
  });

  test("status terminal tidak bisa pindah ke mana pun", () => {
    for (const terminal of ["digunakan", "kedaluwarsa", "dibatalkan"] as const) {
      for (const to of [
        "menunggu-bayar",
        "terbayar",
        "digunakan",
        "kedaluwarsa",
        "dibatalkan",
      ] as const) {
        expect(canTransitionBooking(terminal, to)).toBe(false);
      }
    }
  });

  test("transisi ke status yang sama ditolak (idempotensi di lapisan atas)", () => {
    expect(canTransitionBooking("menunggu-bayar", "menunggu-bayar")).toBe(false);
  });
});

describe("generateBookingCode", () => {
  test("format BK-XXXXXX dengan charset anti-ambigu (tanpa 0/O/1/I/L)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateBookingCode();
      expect(code).toMatch(/^BK-[2-9A-HJ-NP-Z]{6}$/);
    }
  });

  test("dua panggilan menghasilkan kode berbeda (probabilistik)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateBookingCode()));
    expect(codes.size).toBeGreaterThan(45);
  });
});

describe("generateAccessToken", () => {
  test("64 karakter hex dan unik antar panggilan", () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("validateVisitDateWindow", () => {
  const today = "2026-07-22";

  test("hari ini dan besok sah", () => {
    expect(validateVisitDateWindow("2026-07-22", today)).toBe("ok");
    expect(validateVisitDateWindow("2026-07-23", today)).toBe("ok");
  });

  test("tanggal lampau ditolak", () => {
    expect(validateVisitDateWindow("2026-07-21", today)).toBe("masa-lalu");
  });

  test("tepat di batas maks hari ke depan masih sah, lewat satu hari ditolak", () => {
    expect(validateVisitDateWindow("2026-10-20", today)).toBe("ok"); // +90
    expect(validateVisitDateWindow("2026-10-21", today)).toBe("terlalu-jauh");
    expect(BOOKING_MAX_DAYS_AHEAD).toBe(90);
  });

  test("tanggal bukan kalender sungguhan ditolak", () => {
    expect(validateVisitDateWindow("2026-02-30", today)).toBe("tidak-valid");
    expect(validateVisitDateWindow("22-07-2026", today)).toBe("tidak-valid");
  });
});
