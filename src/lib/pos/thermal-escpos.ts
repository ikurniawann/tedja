const ESC = 0x1b;
const GS = 0x1d;

// Kertas thermal 80mm (Font A, 576 dot) = 48 kolom. Dulu 32 (58mm) —
// owner memakai printer 80mm (2026-08-16).
export const THERMAL_WIDTH = 48;

/** Garis pemisah selebar kertas — jangan hardcode jumlah strip di pemanggil. */
export const RECEIPT_DIVIDER = "-".repeat(THERMAL_WIDTH);

export type EscPosAlign = "left" | "center";

export function formatReceiptRow(left: string, right: string, width = THERMAL_WIDTH): string {
  const rightText = right.slice(0, width);
  const leftMax = Math.max(0, width - rightText.length - 1);
  const leftText = left.slice(0, leftMax);
  const spaces = Math.max(1, width - leftText.length - rightText.length);
  return `${leftText}${" ".repeat(spaces)}${rightText}`;
}

/**
 * Center text by padding spaces for fixed-width thermal paper.
 * More reliable than ESC a (justify) on many RawBT / BT printers.
 */
export function centerPad(text: string, width = THERMAL_WIDTH): string {
  const t = text.replace(/\r/g, "").slice(0, width);
  if (t.length >= width) return t;
  const pad = width - t.length;
  const left = Math.floor(pad / 2);
  return `${" ".repeat(left)}${t}`;
}

function pushAscii(bytes: number[], text: string) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes.push(code === 10 ? 0x0a : code < 128 ? code : 0x3f);
  }
}

/** Plain left-aligned lines (legacy). */
export function encodeEscPosText(lines: string[]): Uint8Array {
  return encodeEscPosLines(lines.map((text) => ({ text, align: "left" as const })));
}

/**
 * ESC/POS lines. Centered lines are space-padded (not ESC a) so RawBT printers
 * that ignore/mis-handle justification still print headers/footers in the middle.
 */
export function encodeEscPosLines(
  lines: Array<{ text: string; align?: EscPosAlign }>,
): Uint8Array {
  // Init + force left justify for the whole job (padding handles "center").
  const bytes: number[] = [ESC, 0x40, ESC, 0x61, 0x00];
  for (const line of lines) {
    const align = line.align ?? "left";
    const raw = line.text.replace(/\r/g, "");
    const text = align === "center" ? centerPad(raw) : raw;
    pushAscii(bytes, text);
    bytes.push(0x0a);
  }
  bytes.push(0x0a, 0x0a, GS, 0x56, 0x00);
  return Uint8Array.from(bytes);
}
