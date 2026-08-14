import { describe, expect, it } from "vitest";
import {
  assertProductWarehousesMatchStall,
  posCartHasItems,
  resolvePosSellStall,
} from "./pos-sell-stall";

describe("resolvePosSellStall", () => {
  it("uses active stall cookie when mode is stall", () => {
    expect(
      resolvePosSellStall({
        activeMode: "stall",
        activeStallId: "w-a",
        assignedWarehouseIds: ["w-a", "w-b"],
      })
    ).toEqual({ ok: true, warehouseId: "w-a" });
  });

  it("rejects Semua Stall mode", () => {
    const result = resolvePosSellStall({
      activeMode: "all",
      activeStallId: null,
      assignedWarehouseIds: ["w-a"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("all_stalls");
  });

  it("falls back to sole assignment when cookie unset", () => {
    expect(
      resolvePosSellStall({
        activeMode: "unset",
        activeStallId: null,
        assignedWarehouseIds: ["w-only"],
      })
    ).toEqual({ ok: true, warehouseId: "w-only" });
  });

  it("uses default warehouse when cookie is unset", () => {
    expect(
      resolvePosSellStall({
        activeMode: "unset",
        activeStallId: null,
        assignedWarehouseIds: ["w-1", "w-2"],
        defaultWarehouseId: "w-1",
      })
    ).toEqual({ ok: true, warehouseId: "w-1" });
  });

  it("rejects multi assignment without explicit stall", () => {
    const result = resolvePosSellStall({
      activeMode: "unset",
      activeStallId: null,
      assignedWarehouseIds: ["w-a", "w-b"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("multiple_unselected");
  });

  it("rejects empty assignment", () => {
    const result = resolvePosSellStall({
      activeMode: "unset",
      activeStallId: null,
      assignedWarehouseIds: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_stall");
  });
});

describe("posCartHasItems", () => {
  it("detects non-empty cart JSON", () => {
    expect(posCartHasItems(JSON.stringify({ items: [{ id: "1" }] }))).toBe(true);
  });

  it("treats empty items / invalid JSON as empty", () => {
    expect(posCartHasItems(JSON.stringify({ items: [] }))).toBe(false);
    expect(posCartHasItems(null)).toBe(false);
    expect(posCartHasItems("not-json")).toBe(false);
  });
});

describe("assertProductWarehousesMatchStall", () => {
  it("accepts all items from the sell stall", () => {
    expect(assertProductWarehousesMatchStall(["w-a", "w-a"], "w-a")).toEqual({ ok: true });
  });

  it("rejects foreign or missing stall products", () => {
    expect(assertProductWarehousesMatchStall(["w-a", "w-b"], "w-a").ok).toBe(false);
    expect(assertProductWarehousesMatchStall([null], "w-a").ok).toBe(false);
  });
});
