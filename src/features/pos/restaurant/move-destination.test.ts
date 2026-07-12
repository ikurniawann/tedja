import { describe, expect, it } from "vitest";

import { canPickMoveDestination } from "./move-destination";

describe("canPickMoveDestination", () => {
  it("allows a different available table", () => {
    expect(
      canPickMoveDestination(
        { id: "t2", status: "available", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(true);
  });

  it("rejects the source table", () => {
    expect(
      canPickMoveDestination(
        { id: "t1", status: "available", is_active: true },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
  });

  it("rejects occupied, billing, reserved, maintenance", () => {
    for (const status of ["occupied", "billing", "reserved", "maintenance"]) {
      expect(
        canPickMoveDestination(
          { id: "t2", status, is_active: true },
          { sourceTableId: "t1" }
        )
      ).toBe(false);
    }
  });

  it("rejects inactive tables", () => {
    expect(
      canPickMoveDestination(
        { id: "t2", status: "available", is_active: false },
        { sourceTableId: "t1" }
      )
    ).toBe(false);
  });

  it("allows available when source has no table", () => {
    expect(
      canPickMoveDestination(
        { id: "t2", status: "available", is_active: true },
        { sourceTableId: null }
      )
    ).toBe(true);
  });
});
