import { describe, expect, it } from "vitest";
import {
  assignGridPositions,
  clampPercent,
  isPlaced,
} from "./floor-layout";

describe("clampPercent", () => {
  it("clamps below 0 and above 100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
  });

  it("rounds to 2 decimals", () => {
    expect(clampPercent(12.3456)).toBe(12.35);
  });

  it("returns 0 for non-finite", () => {
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("isPlaced", () => {
  it("requires both coordinates", () => {
    expect(isPlaced(10, 20)).toBe(true);
    expect(isPlaced(null, 20)).toBe(false);
    expect(isPlaced(10, undefined)).toBe(false);
  });
});

describe("assignGridPositions", () => {
  it("places tables in a grid without overlap of keys", () => {
    const map = assignGridPositions(["a", "b", "c"], 2);
    expect(Object.keys(map)).toEqual(["a", "b", "c"]);
    expect(map.a.pos_x).toBeLessThan(map.b.pos_x);
    expect(map.c.pos_y).toBeGreaterThan(map.a.pos_y);
    expect(map.a.pos_x).toBeGreaterThanOrEqual(0);
    expect(map.a.pos_x).toBeLessThanOrEqual(100);
  });
});
