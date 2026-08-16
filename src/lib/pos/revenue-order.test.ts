import { describe, expect, it } from "vitest";
import { isRevenueOrder } from "@/lib/pos/revenue-order";

describe("isRevenueOrder", () => {
  it("counts a stall order without checkout_id as revenue", () => {
    expect(isRevenueOrder({ checkout_id: null })).toBe(true);
  });

  it("counts a child order with checkout_id as revenue (do not skip children)", () => {
    expect(isRevenueOrder({ checkout_id: "chk-1" })).toBe(true);
  });
});
