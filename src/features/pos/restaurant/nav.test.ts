import { describe, expect, it } from "vitest";
import { CASHIER_ROUTES } from "@/features/pos/cashier/constants";
import { RESTAURANT_FROM, buildCashierHandoffUrl } from "./nav";

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
});
