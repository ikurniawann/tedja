import { describe, expect, it } from "vitest";
import {
  allocateCheckoutCharges,
  assertAllModeSellStallAssigned,
  canAddItemToSingleStallCart,
  canSellMixedStall,
  resolveSingleStallSellFromAllMode,
  shouldConfirmClearCart,
  shouldCreateCheckout,
  uniqueStallIds,
} from "./central-cashier";

describe("canSellMixedStall", () => {
  it("requires menu + user flag + mode all", () => {
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: true,
        activeMode: "all",
      })
    ).toBe(true);
  });

  it("rejects switch-only or single stall mode", () => {
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: false,
        activeMode: "all",
      })
    ).toBe(false);
    expect(
      canSellMixedStall({
        hasCentralMenu: true,
        canCentralCheckout: true,
        activeMode: "stall",
      })
    ).toBe(false);
  });
});

describe("checkout decision", () => {
  it("creates checkout only for 2+ stalls", () => {
    expect(uniqueStallIds(["w-a", "w-a", "w-b"])).toEqual(["w-a", "w-b"]);
    expect(shouldCreateCheckout(["w-a"])).toBe(false);
    expect(shouldCreateCheckout(["w-a", "w-b"])).toBe(true);
  });
});

describe("phase-1 single-stall cart", () => {
  it("allows first item and same stall", () => {
    expect(canAddItemToSingleStallCart([], "w-a")).toEqual({ ok: true });
    expect(canAddItemToSingleStallCart(["w-a"], "w-a")).toEqual({ ok: true });
  });

  it("rejects missing or other stall", () => {
    expect(canAddItemToSingleStallCart(["w-a"], "w-b").ok).toBe(false);
    expect(canAddItemToSingleStallCart([], null, { centralAllMode: true }).ok).toBe(false);
  });

  it("allows missing stall outside central all mode", () => {
    expect(canAddItemToSingleStallCart([], null).ok).toBe(true);
    expect(canAddItemToSingleStallCart([], undefined, { centralAllMode: false }).ok).toBe(
      true
    );
  });
});

describe("shouldConfirmClearCart", () => {
  it("is true only when draft cart has items", () => {
    expect(shouldConfirmClearCart(JSON.stringify({ items: [{ id: "1" }] }))).toBe(true);
    expect(shouldConfirmClearCart(JSON.stringify({ items: [] }))).toBe(false);
    expect(shouldConfirmClearCart(null)).toBe(false);
  });
});

describe("resolveSingleStallSellFromAllMode", () => {
  it("sells as the sole cart stall when kasir pusat is in all mode", () => {
    expect(
      resolveSingleStallSellFromAllMode({
        itemWarehouses: ["w-a", "w-a"],
        canSellMixed: true,
      })
    ).toBe("w-a");
  });

  it("returns null for mixed cart or when the central gate is closed", () => {
    expect(
      resolveSingleStallSellFromAllMode({
        itemWarehouses: ["w-a", "w-b"],
        canSellMixed: true,
      })
    ).toBeNull();
    expect(
      resolveSingleStallSellFromAllMode({
        itemWarehouses: ["w-a"],
        canSellMixed: false,
      })
    ).toBeNull();
  });
});

describe("assertAllModeSellStallAssigned", () => {
  it("accepts a stall in the allowed set", () => {
    expect(assertAllModeSellStallAssigned("w-a", ["w-a", "w-b"])).toEqual({ ok: true });
  });

  it("rejects a stall outside the user's allowed stalls", () => {
    const result = assertAllModeSellStallAssigned("w-x", ["w-a", "w-b"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Stall aktif di luar penempatan Anda");
    }
  });
});

describe("allocateCheckoutCharges", () => {
  it("splits proportionally and puts remainder on largest slice", () => {
    const rows = allocateCheckoutCharges({
      slices: [
        { warehouseId: "w-a", subtotal: 10000 },
        { warehouseId: "w-b", subtotal: 5000 },
      ],
      discount: 1500,
      tax: 1350,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].discount + rows[1].discount).toBe(1500);
    expect(rows[0].tax + rows[1].tax).toBe(1350);
    expect(rows[0].warehouseId).toBe("w-a");
    expect(rows[0].discount).toBe(1000);
    expect(rows[1].discount).toBe(500);
  });

  it("returns zeros when checkout subtotal is 0", () => {
    const rows = allocateCheckoutCharges({
      slices: [{ warehouseId: "w-a", subtotal: 0 }],
      discount: 0,
      tax: 0,
      serviceCharge: 0,
      otherCharges: 0,
    });
    expect(rows[0].total).toBe(0);
  });
});
