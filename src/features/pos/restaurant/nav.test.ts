import { describe, expect, it } from "vitest";
import { CASHIER_ROUTES } from "@/features/pos/cashier/constants";
import {
  RESTAURANT_FROM,
  RESTAURANT_IMMERSIVE_PARAM,
  RESTAURANT_PATH,
  buildCashierHandoffUrl,
  isRestaurantImmersive,
  restaurantPath,
} from "./nav";

describe("isRestaurantImmersive", () => {
  it("is true when immersive=1", () => {
    expect(
      isRestaurantImmersive(new URLSearchParams("immersive=1"))
    ).toBe(true);
  });

  it("is false when missing or not 1", () => {
    expect(isRestaurantImmersive(new URLSearchParams())).toBe(false);
    expect(
      isRestaurantImmersive(new URLSearchParams("immersive=true"))
    ).toBe(false);
  });
});

describe("restaurantPath", () => {
  it("returns base path by default", () => {
    expect(restaurantPath()).toBe(RESTAURANT_PATH);
    expect(restaurantPath({})).toBe(RESTAURANT_PATH);
  });

  it("appends immersive=1 when requested", () => {
    expect(restaurantPath({ immersive: true })).toBe(
      `${RESTAURANT_PATH}?${RESTAURANT_IMMERSIVE_PARAM}=1`
    );
  });
});

describe("buildCashierHandoffUrl", () => {
  it("always sets from=restaurant", () => {
    const url = buildCashierHandoffUrl({});

    expect(url).toMatch(new RegExp(`^${CASHIER_ROUTES.embedded}\\?`));
    expect(url).toContain("from=restaurant");
    expect(RESTAURANT_FROM).toBe("restaurant");
  });

  it("includes tableId", () => {
    expect(buildCashierHandoffUrl({ tableId: "abc" })).toContain(
      "tableId=abc"
    );
  });

  it("includes orderType takeaway", () => {
    expect(buildCashierHandoffUrl({ orderType: "takeaway" })).toContain(
      "orderType=takeaway"
    );
  });

  it("includes orderId", () => {
    expect(buildCashierHandoffUrl({ orderId: "ord-1" })).toContain(
      "orderId=ord-1"
    );
  });

  it("includes pay flag", () => {
    expect(buildCashierHandoffUrl({ pay: true })).toContain("pay=1");
  });

  it("includes immersive=1 when requested", () => {
    expect(buildCashierHandoffUrl({ immersive: true })).toContain(
      "immersive=1"
    );
  });

  it("omits immersive when not requested", () => {
    expect(buildCashierHandoffUrl({})).not.toContain("immersive=");
  });
});
