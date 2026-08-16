import { describe, expect, it } from "vitest";
import { groupOrdersByCheckout } from "./order-list-group";

describe("groupOrdersByCheckout", () => {
  it("keeps stall orders without checkout as single rows", () => {
    const rows = groupOrdersByCheckout([
      { id: "a", order_number: "POS-1", total_amount: 10000, ordered_at: "2026-08-16T01:00:00+07:00" },
    ]);
    expect(rows).toEqual([
      {
        kind: "single",
        order: expect.objectContaining({ id: "a" }),
      },
    ]);
  });

  it("collapses mixed-checkout children into one bill", () => {
    const rows = groupOrdersByCheckout([
      {
        id: "c1",
        checkout_id: "chk",
        checkout_number: "CHK-20260816-0003",
        order_number: "POS-4",
        total_amount: 60000,
        payment_status: "paid",
        status: "pending",
        ordered_at: "2026-08-16T08:58:54+07:00",
      },
      {
        id: "c2",
        checkout_id: "chk",
        checkout_number: "CHK-20260816-0003",
        order_number: "POS-5",
        total_amount: 155000,
        payment_status: "paid",
        status: "pending",
        ordered_at: "2026-08-16T08:58:54+07:00",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "checkout",
      checkoutId: "chk",
      checkoutNumber: "CHK-20260816-0003",
      total: 215000,
      paid: true,
    });
    if (rows[0]?.kind === "checkout") {
      expect(rows[0].orders).toHaveLength(2);
    }
  });
});
