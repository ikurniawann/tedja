// src/lib/theme/palette.ts
/** Pure color utilities for runtime theme generation. No dependencies. */

export function normalizeHex(input: string): string {
  let h = input.trim().toLowerCase();
  if (h.startsWith("#")) h = h.slice(1);
  if (/^[0-9a-f]{3}$/.test(h)) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/.test(h)) {
    throw new Error(`Invalid hex color: ${input}`);
  }
  return `#${h}`;
}

function toChannels(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = toChannels(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#000000";

export function pickForeground(bg: string): typeof LIGHT_TEXT | typeof DARK_TEXT {
  return contrastRatio(LIGHT_TEXT, bg) >= contrastRatio(DARK_TEXT, bg)
    ? LIGHT_TEXT
    : DARK_TEXT;
}

export type BrandVars = {
  "--brand-primary": string;
  "--brand-secondary": string;
  "--primary-foreground": string;
};

export function buildBrandVars(primary: string, secondary: string): BrandVars {
  const p = normalizeHex(primary);
  return {
    "--brand-primary": p,
    "--brand-secondary": normalizeHex(secondary),
    "--primary-foreground": pickForeground(p),
  };
}
