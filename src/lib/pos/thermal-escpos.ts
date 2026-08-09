const ESC = 0x1b;
const GS = 0x1d;

export const THERMAL_WIDTH = 32;

export function formatReceiptRow(left: string, right: string, width = THERMAL_WIDTH): string {
  const rightText = right.slice(0, width);
  const leftMax = Math.max(0, width - rightText.length - 1);
  const leftText = left.slice(0, leftMax);
  const spaces = Math.max(1, width - leftText.length - rightText.length);
  return `${leftText}${" ".repeat(spaces)}${rightText}`;
}

export function encodeEscPosText(lines: string[]): Uint8Array {
  const bytes: number[] = [ESC, 0x40, ESC, 0x61, 0x00];
  for (const line of lines) {
    const text = line.replace(/\r/g, "");
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      bytes.push(code === 10 ? 0x0a : code < 128 ? code : 0x3f);
    }
    bytes.push(0x0a);
  }
  bytes.push(0x0a, 0x0a, GS, 0x56, 0x00);
  return Uint8Array.from(bytes);
}
