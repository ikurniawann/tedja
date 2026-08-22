import { describe, expect, it } from "vitest";
import { buildReceiptLines, type ReceiptPayload } from "./PrintReceipt";

const mixedPayload: ReceiptPayload = {
  checkoutNumber: "CHK-20260815-0001",
  queueNumber: "A7",
  orderType: "dine_in",
  table: null,
  items: [
    { id: "1", productId: "p1", name: "Americano", price: 20000, quantity: 1, warehouse_name: "Kopi Nusantara" },
    { id: "2", productId: "p2", name: "Croissant", price: 18000, quantity: 1, warehouse_name: "Bakery" },
  ],
  notes: "",
  total: 38000,
  change: 2000,
  paymentMethod: "cash",
  discountAmount: 0,
  taxAmount: 0,
};

describe("buildReceiptLines mixed checkout", () => {
  it("prints one checkout number, stall sections, one total, and one tender", () => {
    const lines = buildReceiptLines(mixedPayload, "CUSTOMER");
    expect(lines).toContain("Checkout #CHK-20260815-0001");
    expect(lines).toContain("ANTRIAN A7");
    expect(lines).toContain("--- Kopi Nusantara ---");
    expect(lines).toContain("1x Americano");
    expect(lines).toContain("--- Bakery ---");
    expect(lines).toContain("1x Croissant");
    expect(lines.filter((line) => line.startsWith("TOTAL")).length).toBe(1);
    expect(lines.some((line) => line.includes("Bayar (CASH)"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Order #"))).toBe(false);
  });
});

describe("receipt header/footer dari konfigurasi (EPIC-040)", () => {
  const decorated: ReceiptPayload = {
    ...mixedPayload,
    receiptHeader: ["SULU in WOUNDERLAND", "Jl. Ir. H. Juanda 145"],
    receiptFooter: ["Terima kasih!", "WiFi: SULU-GUEST"],
  };

  it("customer copy memuat header di atas dan footer sebelum copy marker", () => {
    const lines = buildReceiptLines(decorated, "CUSTOMER");
    expect(lines[0]).toBe("SULU in WOUNDERLAND");
    expect(lines[1]).toBe("Jl. Ir. H. Juanda 145");
    expect(lines.indexOf("--- CUSTOMER ---")).toBeGreaterThan(1);
    const footerIdx = lines.indexOf("Terima kasih!");
    expect(footerIdx).toBeGreaterThan(lines.findIndex((l) => l.startsWith("TOTAL")));
    expect(lines.indexOf("--- CUSTOMER COPY ---")).toBeGreaterThan(footerIdx);
  });

  it("copy dapur/bar tidak memuat header maupun footer", () => {
    for (const label of ["KITCHEN", "BAR"] as const) {
      const lines = buildReceiptLines(decorated, label);
      expect(lines).not.toContain("SULU in WOUNDERLAND");
      expect(lines).not.toContain("Terima kasih!");
      expect(lines[0]).toBe(`--- ${label} ---`);
    }
  });

  it("payload tanpa konfigurasi identik dengan sebelum EPIC-040", () => {
    expect(buildReceiptLines(mixedPayload, "CUSTOMER")[0]).toBe("--- CUSTOMER ---");
  });

  it("blok ARK: harga, dibayar, sisa saldo — hanya pembayaran ark_coin (EPIC-041)", () => {
    const arkPayload: ReceiptPayload = {
      ...mixedPayload,
      paymentMethod: "ark_coin",
      total: 2400,
      arkPaid: 2400,
      arkBalanceAfter: 200,
      arkRate: 1000,
    };
    const lines = buildReceiptLines(arkPayload, "CUSTOMER");
    expect(lines.some((l) => l.startsWith("Harga") && l.includes("2 ARK"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Dibayar ARK") && l.includes("2 ARK"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Sisa saldo") && l.includes("0 ARK") && l.includes("Rp 200"))).toBe(true);
    // copy dapur & pembayaran non-ARK tidak memuat blok ini
    expect(buildReceiptLines(arkPayload, "KITCHEN").some((l) => l.includes("Sisa saldo"))).toBe(false);
    expect(
      buildReceiptLines({ ...arkPayload, paymentMethod: "cash" }, "CUSTOMER").some((l) =>
        l.includes("Dibayar ARK")
      )
    ).toBe(false);
  });

  it("blok XP: +N dan total member — hanya bila ada XP (EPIC-041)", () => {
    const xpPayload: ReceiptPayload = { ...mixedPayload, xpEarned: 8, xpTotalAfter: 508 };
    const lines = buildReceiptLines(xpPayload, "CUSTOMER");
    expect(lines.some((l) => l.startsWith("XP didapat") && l.includes("+8 XP"))).toBe(true);
    expect(lines.some((l) => l.startsWith("Total XP") && l.includes("508 XP"))).toBe(true);
    expect(buildReceiptLines(xpPayload, "KITCHEN").some((l) => l.includes("XP"))).toBe(false);
    expect(
      buildReceiptLines({ ...mixedPayload, xpEarned: 0, xpTotalAfter: 508 }, "CUSTOMER").some(
        (l) => l.includes("XP")
      )
    ).toBe(false);
  });

  it("receiptShowStallName=false menyembunyikan baris Stall hanya di customer copy", () => {
    const withStall: ReceiptPayload = {
      ...decorated,
      stallName: "Yakitori Stall",
      receiptShowStallName: false,
    };
    expect(buildReceiptLines(withStall, "CUSTOMER")).not.toContain("Stall: Yakitori Stall");
    expect(buildReceiptLines(withStall, "KITCHEN")).toContain("Stall: Yakitori Stall");
    const shown: ReceiptPayload = { ...withStall, receiptShowStallName: true };
    expect(buildReceiptLines(shown, "CUSTOMER")).toContain("Stall: Yakitori Stall");
  });
});
