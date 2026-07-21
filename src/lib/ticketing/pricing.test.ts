import { describe, expect, test } from "vitest";
import {
  findPriceGaps,
  isValidCalendarDate,
  resolvePrice,
  resolveSeasonKind,
  type PriceEntry,
  type SeasonRange,
} from "./pricing";

const season = (overrides: Partial<SeasonRange>): SeasonRange => ({
  season_kind: "high",
  start_date: "2026-12-20",
  end_date: "2027-01-05",
  is_active: true,
  ...overrides,
});

describe("isValidCalendarDate", () => {
  test("menerima tanggal kalender sungguhan", () => {
    expect(isValidCalendarDate("2026-07-21")).toBe(true);
    expect(isValidCalendarDate("2028-02-29")).toBe(true); // kabisat
  });

  test("menolak tanggal palsu dan format salah", () => {
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
    expect(isValidCalendarDate("21-07-2026")).toBe(false);
    expect(isValidCalendarDate("")).toBe(false);
  });
});

describe("resolveSeasonKind", () => {
  test("default regular bila tak ada rentang yang memuat tanggal", () => {
    // Arrange
    const seasons = [season({})];

    // Act
    const kind = resolveSeasonKind("2026-07-21", seasons);

    // Assert
    expect(kind).toBe("regular");
  });

  test("high bila tanggal di dalam rentang high aktif", () => {
    expect(resolveSeasonKind("2026-12-25", [season({})])).toBe("high");
  });

  test("batas rentang inklusif di kedua ujung", () => {
    const seasons = [season({})];
    expect(resolveSeasonKind("2026-12-20", seasons)).toBe("high");
    expect(resolveSeasonKind("2027-01-05", seasons)).toBe("high");
    expect(resolveSeasonKind("2026-12-19", seasons)).toBe("regular");
    expect(resolveSeasonKind("2027-01-06", seasons)).toBe("regular");
  });

  test("rentang nonaktif diabaikan", () => {
    const seasons = [season({ is_active: false })];
    expect(resolveSeasonKind("2026-12-25", seasons)).toBe("regular");
  });

  test("high menang bila overlap dengan rentang regular", () => {
    const seasons = [
      season({ season_kind: "regular", start_date: "2026-12-01", end_date: "2026-12-31" }),
      season({ start_date: "2026-12-24", end_date: "2026-12-26" }),
    ];
    expect(resolveSeasonKind("2026-12-25", seasons)).toBe("high");
    expect(resolveSeasonKind("2026-12-10", seasons)).toBe("regular");
  });

  test("melempar error untuk tanggal tidak valid", () => {
    expect(() => resolveSeasonKind("bukan-tanggal", [])).toThrow(
      /tidak valid/
    );
  });
});

describe("resolvePrice", () => {
  const prices: PriceEntry[] = [
    { ticket_type_id: "adult", season_kind: "regular", channel_id: "walkin", price: 100_000 },
    { ticket_type_id: "adult", season_kind: "high", channel_id: "walkin", price: 150_000 },
    { ticket_type_id: "child", season_kind: "regular", channel_id: "walkin", price: 60_000 },
  ];

  test("mengembalikan harga kombinasi yang tepat", () => {
    expect(
      resolvePrice(prices, {
        ticketTypeId: "adult",
        seasonKind: "high",
        channelId: "walkin",
      })
    ).toBe(150_000);
  });

  test("null bila matriks berlubang — pemanggil wajib menolak transaksi", () => {
    expect(
      resolvePrice(prices, {
        ticketTypeId: "child",
        seasonKind: "high",
        channelId: "walkin",
      })
    ).toBeNull();
  });
});

describe("findPriceGaps", () => {
  test("mendeteksi kombinasi yang belum punya harga", () => {
    // Arrange
    const prices: PriceEntry[] = [
      { ticket_type_id: "adult", season_kind: "regular", channel_id: "walkin", price: 100_000 },
      { ticket_type_id: "adult", season_kind: "high", channel_id: "walkin", price: 150_000 },
      { ticket_type_id: "child", season_kind: "regular", channel_id: "walkin", price: 60_000 },
    ];

    // Act
    const gaps = findPriceGaps(["adult", "child"], ["walkin"], prices);

    // Assert
    expect(gaps).toEqual([
      { ticket_type_id: "child", season_kind: "high", channel_id: "walkin" },
    ]);
  });

  test("matriks penuh → tanpa lubang", () => {
    const prices: PriceEntry[] = [
      { ticket_type_id: "adult", season_kind: "regular", channel_id: "walkin", price: 1 },
      { ticket_type_id: "adult", season_kind: "high", channel_id: "walkin", price: 2 },
    ];
    expect(findPriceGaps(["adult"], ["walkin"], prices)).toEqual([]);
  });

  test("tanpa tipe/kanal aktif → tanpa lubang", () => {
    expect(findPriceGaps([], ["walkin"], [])).toEqual([]);
    expect(findPriceGaps(["adult"], [], [])).toEqual([]);
  });
});
