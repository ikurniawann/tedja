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
