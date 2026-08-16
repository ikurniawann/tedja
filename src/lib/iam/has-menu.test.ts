import { describe, expect, it } from "vitest";
import { hasIamMenuCode } from "./has-menu";

describe("hasIamMenuCode", () => {
  it("matches exact code", () => {
    expect(hasIamMenuCode(["pos.operations.cashier", "pos.cashier.central"], "pos.cashier.central")).toBe(true);
    expect(hasIamMenuCode(["pos.operations.cashier"], "pos.cashier.central")).toBe(false);
  });
});
