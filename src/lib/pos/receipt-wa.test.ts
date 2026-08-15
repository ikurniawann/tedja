import { describe, expect, it } from "vitest";

import {
  buildOrderReceiptMessage,
  buildShiftReportMessage,
  buildTopupReceiptMessage,
  normalizeWaPhone,
} from "./receipt-wa";

/**
 * Tes ditulis lebih dulu (fitur WA struk & laporan tutup kasir).
 *
 * Pesan-pesan ini dikirim ke PELANGGAN dan OWNER — sekali salah format
 * (angka rupiah tanpa pemisah, nomor tak ternormalisasi sampai gagal kirim)
 * langsung terlihat oleh orang di luar tim. Karena itu builder dibuat murni
 * dan diuji, bukan digabung ke route handler.
 */

describe("normalizeWaPhone", () => {
  it("mengubah 08xx menjadi 628xx", () => {
    expect(normalizeWaPhone("081234567890")).toBe("6281234567890");
  });

  it("menerima +62 dan spasi/strip dari input kasir", () => {
    expect(normalizeWaPhone("+62 812-3456-7890")).toBe("6281234567890");
  });

  it("input terlalu pendek atau kosong → null, bukan mengirim ke nomor rusak", () => {
    expect(normalizeWaPhone("0812")).toBeNull();
    expect(normalizeWaPhone("")).toBeNull();
    expect(normalizeWaPhone(null)).toBeNull();
  });
});

describe("buildOrderReceiptMessage", () => {
  const dasar = {
    outletName: "Sulu",
    orderNumber: "ORD-001",
    orderedAt: "2026-08-14T12:30:00+07:00",
    items: [
      { name: "Kopi Susu", quantity: 2, total: 36_000 },
      { name: "Croissant", quantity: 1, total: 28_000 },
    ],
    total: 64_000,
    paymentMethod: "cash",
    change: 6_000,
  };

  it("memuat nomor order, tiap item, total, dan kembalian", () => {
    const pesan = buildOrderReceiptMessage(dasar);
    expect(pesan).toContain("ORD-001");
    expect(pesan).toContain("2x Kopi Susu");
    expect(pesan).toContain("Rp 36.000");
    expect(pesan).toContain("Rp 64.000");
    expect(pesan).toContain("Kembalian");
  });

  it("tanpa kembalian (non-tunai) baris kembalian tidak muncul", () => {
    const pesan = buildOrderReceiptMessage({ ...dasar, paymentMethod: "qris", change: 0 });
    expect(pesan).not.toContain("Kembalian");
    expect(pesan.toUpperCase()).toContain("QRIS");
  });

  it("diskon tampil hanya bila ada", () => {
    expect(buildOrderReceiptMessage(dasar)).not.toContain("Diskon");
    expect(
      buildOrderReceiptMessage({ ...dasar, discountAmount: 5_000 })
    ).toContain("Diskon");
  });
});

describe("buildTopupReceiptMessage", () => {
  it("memuat nama, nominal, dan saldo akhir", () => {
    const pesan = buildTopupReceiptMessage({
      outletName: "Sulu",
      customerName: "Budi",
      amount: 100_000,
      method: "cash",
      balanceAfter: 150_000,
      at: "2026-08-14T12:30:00+07:00",
    });
    expect(pesan).toContain("Budi");
    expect(pesan).toContain("Rp 100.000");
    expect(pesan).toContain("Rp 150.000");
  });

  it("saldo akhir tidak diketahui → barisnya hilang, bukan 'Rp 0' yang menakutkan", () => {
    const pesan = buildTopupReceiptMessage({
      outletName: "Sulu",
      customerName: "Budi",
      amount: 100_000,
      method: "cash",
      balanceAfter: null,
      at: "2026-08-14T12:30:00+07:00",
    });
    expect(pesan).not.toContain("Saldo");
  });
});

describe("buildShiftReportMessage", () => {
  it("memuat angka-angka inti tutup kasir", () => {
    const pesan = buildShiftReportMessage({
      outletName: "Sulu",
      shiftNumber: "SH-014",
      cashierName: "Ani",
      openedAt: "2026-08-14T08:00:00+07:00",
      closedAt: "2026-08-14T16:00:00+07:00",
      totalOrders: 42,
      totalSales: 3_500_000,
      openingCash: 500_000,
      expectedCash: 2_100_000,
      closingCash: 2_095_000,
      variance: -5_000,
    });
    expect(pesan).toContain("SH-014");
    expect(pesan).toContain("Ani");
    expect(pesan).toContain("42");
    expect(pesan).toContain("Rp 3.500.000");
    expect(pesan).toContain("-Rp 5.000"); // selisih minus harus jujur, bukan disembunyikan
  });

  it("selisih nol ditulis pas, bukan minus", () => {
    const pesan = buildShiftReportMessage({
      outletName: "Sulu",
      shiftNumber: "SH-015",
      cashierName: "Ani",
      openedAt: "2026-08-14T08:00:00+07:00",
      closedAt: "2026-08-14T16:00:00+07:00",
      totalOrders: 1,
      totalSales: 10_000,
      openingCash: 0,
      expectedCash: 10_000,
      closingCash: 10_000,
      variance: 0,
    });
    expect(pesan).toContain("pas");
  });
});
