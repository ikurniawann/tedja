import { describe, expect, it } from "vitest";
import { encodeEscPosText, formatReceiptRow } from "@/lib/pos/thermal-escpos";

describe("formatReceiptRow", () => {
  it("aligns left and right within 32 columns", () => {
    expect(formatReceiptRow("TOTAL", "Rp 128.000")).toBe(`TOTAL${" ".repeat(17)}Rp 128.000`);
    expect(formatReceiptRow("TOTAL", "Rp 128.000").length).toBe(32);
  });
});

describe("encodeEscPosText", () => {
  it("starts with init and ends with cut", () => {
    const bytes = encodeEscPosText(["ARKIV", "TOTAL"]);
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x00]);
    expect(Array.from(bytes.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
    expect(String.fromCharCode(...bytes.slice(5, 10))).toBe("ARKIV");
  });
});
