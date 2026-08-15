import { describe, expect, it } from "vitest";
import { listTableBoardBills } from "./table-board-bills";

describe("listTableBoardBills", () => {
  it("lists every unpaid stall order on the same table", () => {
    const bills = listTableBoardBills({
      tableId: "t1",
      orders: [
        {
          id: "o1",
          table_id: "t1",
          payment_status: "unpaid",
          status: "pending",
          sold_from: "stall",
          order_number: "STALL-1",
          total_amount: 10,
        },
        {
          id: "o2",
          table_id: "t1",
          payment_status: "unpaid",
          status: "pending",
          sold_from: "stall",
          order_number: "STALL-2",
          total_amount: 20,
        },
      ],
    });
    expect(bills).toHaveLength(2);
    expect(bills.map((bill) => bill.id)).toEqual(["o1", "o2"]);
  });

  it("collapses checkout children into one bill and keeps stall orders separate", () => {
    const bills = listTableBoardBills({
      tableId: "t5",
      orders: [
        {
          id: "c1",
          table_id: "t5",
          checkout_id: "chk-1",
          payment_status: "unpaid",
          status: "pending",
          sold_from: "central",
          total_amount: 30,
        },
        {
          id: "c2",
          table_id: "t5",
          checkout_id: "chk-1",
          payment_status: "unpaid",
          status: "pending",
          sold_from: "central",
          total_amount: 40,
        },
        {
          id: "c3",
          table_id: "t5",
          checkout_id: "chk-1",
          payment_status: "unpaid",
          status: "pending",
          sold_from: "central",
          total_amount: 50,
        },
        {
          id: "s1",
          table_id: "t5",
          payment_status: "unpaid",
          status: "pending",
          sold_from: "stall",
          order_number: "STALL-9",
          total_amount: 15,
        },
      ],
      checkouts: [
        {
          id: "chk-1",
          table_id: "t5",
          payment_status: "unpaid",
          checkout_number: "CHK-1",
          total_amount: 120,
        },
      ],
    });
    expect(bills).toHaveLength(2);
    expect(bills[0]).toMatchObject({
      kind: "checkout",
      id: "chk-1",
      label: "CHK-1",
      total_amount: 120,
    });
    expect(bills[1]).toMatchObject({
      kind: "order",
      id: "s1",
      soldFrom: "stall",
    });
  });

  it("keeps an unpaid checkout with no children", () => {
    const bills = listTableBoardBills({
      tableId: "t1",
      checkouts: [
        {
          id: "chk-empty",
          table_id: "t1",
          payment_status: "unpaid",
          checkout_number: "CHK-OPEN",
          total_amount: 80,
        },
      ],
    });
    expect(bills).toEqual([
      expect.objectContaining({
        id: "chk-empty",
        kind: "checkout",
        label: "CHK-OPEN",
        total_amount: 80,
        orderId: null,
      }),
    ]);
  });

  it("excludes paid orders and other tables", () => {
    const bills = listTableBoardBills({
      tableId: "t1",
      orders: [
        {
          id: "paid",
          table_id: "t1",
          payment_status: "paid",
          status: "completed",
          sold_from: "stall",
        },
        {
          id: "other",
          table_id: "t2",
          payment_status: "unpaid",
          status: "pending",
          sold_from: "stall",
        },
      ],
    });
    expect(bills).toEqual([]);
  });
});
