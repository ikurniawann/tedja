import { describe, expect, it } from "vitest";
import {
  calculateSpendXp,
  calculateTopupXp,
  formatArkAmount,
  idrToArk,
  normalizeLoyaltySettings,
  normalizeTopupPresets,
} from "./loyalty-settings";

describe("normalizeTopupPresets", () => {
  it("dedupes and sorts positive amounts", () => {
    expect(normalizeTopupPresets([100000, 50000, 50000, 0, -1])).toEqual([50000, 100000]);
  });

  it("falls back to defaults when empty", () => {
    expect(normalizeTopupPresets([])).toEqual([50000, 100000, 200000, 500000, 1000000]);
  });
});

describe("normalizeLoyaltySettings", () => {
  it("applies defaults for missing row", () => {
    const settings = normalizeLoyaltySettings(null);
    expect(settings.ark_rate).toBe(1000);
    expect(settings.topup_min_amount).toBe(10000);
    expect(settings.spend_xp_enabled).toBe(true);
  });
});

describe("ARK helpers", () => {
  it("converts IDR balance to ARK", () => {
    expect(idrToArk(50000, 1000)).toBe(50);
    expect(formatArkAmount(50000, 1000)).toContain("50");
  });
});

describe("calculateTopupXp", () => {
  it("awards fixed XP", () => {
    expect(
      calculateTopupXp(100000, {
        topup_xp_enabled: true,
        topup_xp_mode: "fixed",
        topup_xp_value: 5,
        topup_xp_amount_step: 10000,
      })
    ).toBe(5);
  });

  it("awards per_amount XP", () => {
    expect(
      calculateTopupXp(55000, {
        topup_xp_enabled: true,
        topup_xp_mode: "per_amount",
        topup_xp_value: 1,
        topup_xp_amount_step: 10000,
      })
    ).toBe(5);
  });

  it("returns 0 when disabled", () => {
    expect(
      calculateTopupXp(100000, {
        topup_xp_enabled: false,
        topup_xp_mode: "per_amount",
        topup_xp_value: 1,
        topup_xp_amount_step: 10000,
      })
    ).toBe(0);
  });
});

describe("calculateSpendXp", () => {
  it("mirrors legacy 1 XP per 10_000 with min 1", () => {
    expect(
      calculateSpendXp(15000, {
        spend_xp_enabled: true,
        spend_xp_amount_step: 10000,
        spend_xp_min: 1,
      })
    ).toBe(1);

    expect(
      calculateSpendXp(45000, {
        spend_xp_enabled: true,
        spend_xp_amount_step: 10000,
        spend_xp_min: 1,
      })
    ).toBe(4);
  });

  it("returns 0 when disabled", () => {
    expect(
      calculateSpendXp(100000, {
        spend_xp_enabled: false,
        spend_xp_amount_step: 10000,
        spend_xp_min: 1,
      })
    ).toBe(0);
  });
});
