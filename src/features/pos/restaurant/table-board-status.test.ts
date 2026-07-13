import { describe, expect, it } from "vitest";
import { resolveTableBoardStatus } from "./table-board-status";

describe("resolveTableBoardStatus", () => {
  it("returns available when idle", () => {
    expect(resolveTableBoardStatus({ tableStatus: "available" })).toBe(
      "available"
    );
  });

  it("keeps reserved/maintenance when idle", () => {
    expect(resolveTableBoardStatus({ tableStatus: "reserved" })).toBe("reserved");
    expect(resolveTableBoardStatus({ tableStatus: "maintenance" })).toBe(
      "maintenance"
    );
  });

  it("returns occupied for active unpaid order", () => {
    expect(
      resolveTableBoardStatus({
        tableStatus: "available",
        activeOrder: { payment_status: "unpaid", pre_settled_at: null },
      })
    ).toBe("occupied");
  });

  it("returns billing when pre-settled", () => {
    expect(
      resolveTableBoardStatus({
        activeOrder: {
          payment_status: "unpaid",
          pre_settled_at: "2026-07-12T08:00:00.000Z",
        },
      })
    ).toBe("billing");
  });

  it("active order wins over reserved master status", () => {
    expect(
      resolveTableBoardStatus({
        tableStatus: "reserved",
        activeOrder: { pre_settled_at: null },
      })
    ).toBe("occupied");
  });
});
