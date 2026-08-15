import { describe, expect, it } from "vitest";
import {
  canAppendTransferItems,
  resolveTableSaleTarget,
} from "./table-sale-target";

describe("resolveTableSaleTarget", () => {
  it("always creates a new stall order, even beside an unpaid checkout", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "stall",
        unpaidCentralCheckoutId: "chk-1",
      })
    ).toEqual({ action: "create_order" });
  });

  it("appends kasir pusat mixed items onto that table's unpaid central checkout", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_mixed",
        unpaidCentralCheckoutId: "chk-1",
      })
    ).toEqual({ action: "append_checkout", checkoutId: "chk-1" });
  });

  it("opens a new checkout when the table only has stall orders", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_mixed",
        unpaidCentralCheckoutId: null,
      })
    ).toEqual({ action: "create_checkout" });
  });

  it("opens a new checkout after the previous central bill is paid", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_mixed",
      })
    ).toEqual({ action: "create_checkout" });
  });

  it("keeps a 1-stall kasir pusat sale on the order path", () => {
    expect(
      resolveTableSaleTarget({
        saleKind: "central_single",
        unpaidCentralCheckoutId: "chk-1",
      })
    ).toEqual({ action: "create_order" });
  });
});

describe("canAppendTransferItems", () => {
  it("allows stall → stall and central → central", () => {
    expect(
      canAppendTransferItems({ sold_from: "stall" }, { sold_from: "stall" })
    ).toBe(true);
    expect(
      canAppendTransferItems(
        { checkout_id: "chk-1", sold_from: "central" },
        { checkout_id: "chk-1", sold_from: "central" }
      )
    ).toBe(true);
  });

  it("rejects merging a stall order into a central checkout", () => {
    expect(
      canAppendTransferItems(
        { sold_from: "stall", checkout_id: null },
        { sold_from: "central", checkout_id: "chk-1" }
      )
    ).toBe(false);
  });
});
