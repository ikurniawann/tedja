import { describe, expect, test } from "vitest";
import {
  BOOKING_MAX_DAYS_AHEAD,
  canTransitionBooking,
  generateAccessToken,
  generateBookingCode,
  matchRedeemBands,
  normalizeBookingCode,
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

describe("matchRedeemBands (validasi gelang saat redeem loket)", () => {
  const items = [
    { variant_id: "dewasa", qty: 2 },
    { variant_id: "anak", qty: 1 },
  ];

  test("jumlah gelang per varian persis sama → ok", () => {
    // Arrange + Act
    const result = matchRedeemBands(items, [
      { variant_id: "dewasa" },
      { variant_id: "anak" },
      { variant_id: "dewasa" },
    ]);
    // Assert
    expect(result).toEqual({ ok: true });
  });

  test("gelang kurang ditolak dengan rincian varian yang kurang", () => {
    const result = matchRedeemBands(items, [
      { variant_id: "dewasa" },
      { variant_id: "anak" },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "jumlah-tak-cocok",
      variant_id: "dewasa",
      expected: 2,
      actual: 1,
    });
  });

  test("gelang lebih dari qty booking ditolak", () => {
    const result = matchRedeemBands(items, [
      { variant_id: "dewasa" },
      { variant_id: "dewasa" },
      { variant_id: "dewasa" },
      { variant_id: "anak" },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "jumlah-tak-cocok",
      variant_id: "dewasa",
      expected: 2,
      actual: 3,
    });
  });

  test("varian di luar booking ditolak sebagai varian-asing", () => {
    const result = matchRedeemBands(items, [
      { variant_id: "dewasa" },
      { variant_id: "vip" },
    ]);
    expect(result).toEqual({
      ok: false,
      reason: "varian-asing",
      variant_id: "vip",
      expected: 0,
      actual: 1,
    });
  });

  test("item duplikat varian yang sama dijumlahkan kebutuhannya", () => {
    const doubled = [
      { variant_id: "dewasa", qty: 1 },
      { variant_id: "dewasa", qty: 1 },
    ];
    expect(
      matchRedeemBands(doubled, [
        { variant_id: "dewasa" },
        { variant_id: "dewasa" },
      ])
    ).toEqual({ ok: true });
  });

  test("booking tanpa item vs tanpa gelang → ok (degenerate)", () => {
    expect(matchRedeemBands([], [])).toEqual({ ok: true });
  });
});

describe("normalizeBookingCode", () => {
  test("hasil generate selalu lolos normalisasi apa adanya", () => {
    const code = generateBookingCode();
    expect(normalizeBookingCode(code)).toBe(code);
  });

  test("huruf kecil dan spasi dinormalkan", () => {
    expect(normalizeBookingCode("  bk-abcdef ")).toBe("BK-ABCDEF");
  });

  test("prefix BK- yang tertinggal ditambahkan", () => {
    expect(normalizeBookingCode("ABCDEF")).toBe("BK-ABCDEF");
    expect(normalizeBookingCode("bkabcdef")).toBe("BK-ABCDEF");
  });

  test("charset ambigu / panjang salah ditolak", () => {
    expect(normalizeBookingCode("BK-ABC10I")).toBeNull(); // 0/1/I terlarang
    expect(normalizeBookingCode("BK-ABCDE")).toBeNull();
    expect(normalizeBookingCode("")).toBeNull();
  });
});
