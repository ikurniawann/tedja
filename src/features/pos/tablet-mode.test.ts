import { describe, expect, it } from "vitest";
import {
  cashierTabletRoute,
  isPosImmersiveShell,
  isPosTabletQuery,
  withPosTabletParam,
} from "./tablet-mode";

describe("isPosTabletQuery", () => {
  it("accepts 1 or true", () => {
    expect(isPosTabletQuery(new URLSearchParams("tablet=1"))).toBe(true);
    expect(isPosTabletQuery(new URLSearchParams("tablet=true"))).toBe(true);
    expect(isPosTabletQuery(new URLSearchParams("tablet=0"))).toBe(false);
  });
});

describe("isPosImmersiveShell", () => {
  it("is true for cashier-fullscreen", () => {
    expect(
      isPosImmersiveShell("/dashboard/pos/cashier-fullscreen", new URLSearchParams())
    ).toBe(true);
  });

  it("is true for POS paths with tablet=1", () => {
    expect(
      isPosImmersiveShell(
        "/dashboard/pos/cashier-new",
        new URLSearchParams("tablet=1")
      )
    ).toBe(true);
  });

  it("is true for restaurant immersive", () => {
    expect(
      isPosImmersiveShell(
        "/dashboard/pos/restaurant",
        new URLSearchParams("immersive=1")
      )
    ).toBe(true);
  });

  it("is false for normal dashboard POS", () => {
    expect(
      isPosImmersiveShell("/dashboard/pos/cashier-new", new URLSearchParams())
    ).toBe(false);
  });
});

describe("cashierTabletRoute", () => {
  it("points at fullscreen with tablet flag", () => {
    expect(cashierTabletRoute()).toBe(
      "/dashboard/pos/cashier-fullscreen?tablet=1"
    );
  });
});

describe("withPosTabletParam", () => {
  it("appends tablet=1", () => {
    expect(withPosTabletParam("/dashboard/pos/restaurant")).toBe(
      "/dashboard/pos/restaurant?tablet=1"
    );
  });
});
