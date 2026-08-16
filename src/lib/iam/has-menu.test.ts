import { describe, expect, it } from "vitest";
import { hasAnyIamMenuPrefix, hasIamMenuCode } from "./has-menu";

describe("hasIamMenuCode", () => {
  it("matches exact code", () => {
    expect(hasIamMenuCode(["pos.operations.cashier", "pos.cashier.central"], "pos.cashier.central")).toBe(true);
    expect(hasIamMenuCode(["pos.operations.cashier"], "pos.cashier.central")).toBe(false);
  });
});

describe("hasAnyIamMenuPrefix", () => {
  it("matches a granted child under the prefix", () => {
    expect(
      hasAnyIamMenuPrefix(["items.product.master.products"], ["items.product", "pos.catalog"])
    ).toBe(true);
  });

  it("rejects unrelated menus", () => {
    expect(hasAnyIamMenuPrefix(["ess.home", "pos.operations.cashier"], ["items.product"])).toBe(
      false
    );
  });
});
