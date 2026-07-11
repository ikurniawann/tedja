// src/lib/theme/palette.test.ts
import { describe, expect, it } from "vitest";
import {
  buildBrandVars,
  contrastRatio,
  normalizeHex,
  pickForeground,
  relativeLuminance,
} from "./palette";

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#FFF")).toBe("#ffffff");
    expect(normalizeHex("DB2777")).toBe("#db2777");
  });
  it("throws on invalid input", () => {
    expect(() => normalizeHex("not-a-color")).toThrow();
    expect(() => normalizeHex("#12")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and ~1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21 for black vs white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });
});

describe("pickForeground", () => {
  it("uses white text on the dark default pink", () => {
    expect(pickForeground("#db2777")).toBe("#ffffff");
  });
  it("uses dark text on a light brand color", () => {
    expect(pickForeground("#fde68a")).toBe("#0a0a0a");
  });
  it("guarantees >= 4.5 contrast against the chosen brand", () => {
    for (const c of ["#db2777", "#0ea5e9", "#10b981", "#fde68a", "#111827"]) {
      const fg = pickForeground(c);
      expect(contrastRatio(fg, c)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("buildBrandVars", () => {
  it("returns the three runtime-injected variables", () => {
    const vars = buildBrandVars("db2777", "#ec4899");
    expect(vars["--brand-primary"]).toBe("#db2777");
    expect(vars["--brand-secondary"]).toBe("#ec4899");
    expect(vars["--primary-foreground"]).toBe("#ffffff");
  });
});
