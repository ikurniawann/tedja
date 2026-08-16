import { describe, expect, it } from "vitest";
import {
  flattenOrderItems,
  mergeBillTransactionDetail,
} from "./order-transaction-detail";

describe("mergeBillTransactionDetail", () => {
  it("sums mixed-checkout money fields", () => {
    const merged = mergeBillTransactionDetail(
      {
        id: "a",
        checkout_number: "CHK-1",
        subtotal: 10_000,
        total_amount: 10_000,
      },
      [
        { id: "a", subtotal: 10_000, total_amount: 10_000, discount_amount: 0 },
        { id: "b", subtotal: 25_000, total_amount: 20_000, discount_amount: 5_000 },
      ]
    );
    expect(merged.checkout_number).toBe("CHK-1");
    expect(merged.subtotal).toBe(35_000);
    expect(merged.total_amount).toBe(30_000);
    expect(merged.discount_amount).toBe(5_000);
  });
});

describe("flattenOrderItems", () => {
  it("keeps sku and line totals", () => {
    expect(
      flattenOrderItems([
        {
          id: "o1",
          items: [
            {
              product_id: "p1",
              product_name: "Kopi",
              product_sku: "KOPI",
              quantity: 2,
              unit_price: 15_000,
              subtotal: 30_000,
              total_amount: 30_000,
            },
          ],
        },
      ])
    ).toEqual([
      expect.objectContaining({
        product_name: "Kopi",
        product_sku: "KOPI",
        quantity: 2,
        total_amount: 30_000,
      }),
    ]);
  });
});
