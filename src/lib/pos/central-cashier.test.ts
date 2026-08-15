import { describe, expect, it } from "vitest";
import {
  canAddItemToSingleStallCart,
  canSellMixedStall,
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
    expect(canAddItemToSingleStallCart([], null).ok).toBe(false);
  });
});

describe("shouldConfirmClearCart", () => {
  it("is true only when draft cart has items", () => {
    expect(shouldConfirmClearCart(JSON.stringify({ items: [{ id: "1" }] }))).toBe(true);
    expect(shouldConfirmClearCart(JSON.stringify({ items: [] }))).toBe(false);
    expect(shouldConfirmClearCart(null)).toBe(false);
  });
});
