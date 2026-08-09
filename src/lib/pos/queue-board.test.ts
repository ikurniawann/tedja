import { describe, expect, it } from "vitest";
import { splitQueueBoardOrders } from "@/lib/pos/queue-board";
import type { KDSOrder } from "@/features/pos/kds/types";

function order(partial: Partial<KDSOrder> & { id: string }): KDSOrder {
  return {
    order_number: partial.order_number || partial.id,
    status: "pending",
    payment_status: "unpaid",
    order_type: "dine_in",
    ordered_at: new Date().toISOString(),
    pos_order_items: [],
    wait_seconds: 0,
    wait_minutes: 0,
    is_overdue: false,
    is_urgent: false,
    ...partial,
  };
}

describe("splitQueueBoardOrders", () => {
  it("splits preparing vs ready and sorts by queue number", () => {
    const { preparing, ready } = splitQueueBoardOrders([
      order({ id: "a", queue_number: "012", station_status: "ready" }),
      order({ id: "b", queue_number: "003", status: "preparing" }),
      order({ id: "c", queue_number: "001", station_status: "pending" }),
      order({ id: "d", queue_number: "002", station_status: "ready" }),
      order({ id: "e", queue_number: "099", status: "served" }),
    ]);

    expect(preparing.map((row) => row.queue_number)).toEqual(["001", "003"]);
    expect(ready.map((row) => row.queue_number)).toEqual(["002", "012"]);
  });
});
