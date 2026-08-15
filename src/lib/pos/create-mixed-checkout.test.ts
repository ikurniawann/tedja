import { describe, expect, it } from "vitest";
import { allocateCheckoutCharges } from "@/lib/pos/central-cashier";
import {
  MISSING_PRODUCT_STALL_MESSAGE,
  MIXED_SPLIT_UNSUPPORTED_MESSAGE,
  MIXED_STALL_FORBIDDEN_MESSAGE,
  groupItemsByStall,
  guardMixedCheckoutCart,
  resolveOrderSoldFrom,
  shouldInsertCheckoutChildren,
  shouldReuseCheckoutQris,
} from "@/lib/pos/create-mixed-checkout";

describe("guardMixedCheckoutCart", () => {
  it("rejects any product without warehouse_id", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", null],
      ]),
      canSellMixed: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(MISSING_PRODUCT_STALL_MESSAGE);
    }
  });

  it("rejects mixed stalls without kasir pusat gate", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(MIXED_STALL_FORBIDDEN_MESSAGE);
    }
  });

  it("creates checkout when mixed stalls and gate is open", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: true,
    });
    expect(result).toEqual({
      ok: true,
      createCheckout: true,
      stallIds: ["w-a", "w-b"],
    });
  });

  it("keeps the single-stall order path", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-a"],
      ]),
      canSellMixed: true,
    });
    expect(result).toEqual({
      ok: true,
      createCheckout: false,
      stallIds: ["w-a"],
    });
  });

  it("rejects split bill on mixed checkout", () => {
    const result = guardMixedCheckoutCart({
      productIds: ["p1", "p2"],
      warehouseByProduct: new Map([
        ["p1", "w-a"],
        ["p2", "w-b"],
      ]),
      canSellMixed: true,
      hasSplits: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(MIXED_SPLIT_UNSUPPORTED_MESSAGE);
    }
  });
});

describe("groupItemsByStall", () => {
  it("groups cart lines by warehouse", () => {
    const grouped = groupItemsByStall(
      [
        { product_id: "p1", warehouse_id: "w-a" },
        { product_id: "p2", warehouse_id: "w-b" },
        { product_id: "p3", warehouse_id: "w-a" },
      ],
      (item) => item.warehouse_id
    );
    expect([...grouped.keys()]).toEqual(["w-a", "w-b"]);
    expect(grouped.get("w-a")?.map((item) => item.product_id)).toEqual(["p1", "p3"]);
    expect(grouped.get("w-b")?.map((item) => item.product_id)).toEqual(["p2"]);
  });
});

describe("shouldInsertCheckoutChildren", () => {
  it("skips children for unpaid QRIS prepare", () => {
    expect(
      shouldInsertCheckoutChildren({
        paymentMethod: "qris",
        paymentStatus: "unpaid",
        amountPaid: 0,
        total: 25000,
      })
    ).toBe(false);
  });

  it("inserts children for cash/debit paid checkout", () => {
    expect(
      shouldInsertCheckoutChildren({
        paymentMethod: "cash",
        paymentStatus: "paid",
        amountPaid: 25000,
        total: 25000,
      })
    ).toBe(true);
    expect(
      shouldInsertCheckoutChildren({
        paymentMethod: "debit",
        amountPaid: 25000,
        total: 25000,
      })
    ).toBe(true);
  });
});

describe("resolveOrderSoldFrom", () => {
  it("marks kasir pusat sales as central even for one stall", () => {
    expect(resolveOrderSoldFrom({ isCentralCashier: true })).toBe("central");
    expect(resolveOrderSoldFrom({ isCentralCashier: false })).toBe("stall");
  });
});

describe("shouldReuseCheckoutQris", () => {
  it("reuses an existing Xendit id so a second QR is not created", () => {
    expect(
      shouldReuseCheckoutQris({
        xendit_qr_id: null,
        xendit_external_id: "pos-chk-1",
      })
    ).toBe(true);
    expect(
      shouldReuseCheckoutQris({
        xendit_qr_id: "qr_1",
        xendit_external_id: null,
      })
    ).toBe(true);
    expect(
      shouldReuseCheckoutQris({
        xendit_qr_id: null,
        xendit_external_id: null,
      })
    ).toBe(false);
  });
});

describe("allocateCheckoutCharges for mixed children", () => {
  it("keeps stall subtotals and allocated totals summing to checkout", () => {
    const rows = allocateCheckoutCharges({
      slices: [
        { warehouseId: "w-a", subtotal: 20000 },
        { warehouseId: "w-b", subtotal: 10000 },
      ],
      discount: 3000,
      tax: 2700,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].total + rows[1].total).toBe(20000 + 10000 - 3000 + 2700);
    expect(rows[0].warehouseId).toBe("w-a");
  });
});
