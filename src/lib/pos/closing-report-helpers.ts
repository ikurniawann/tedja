export type SalesSegmentCode = "FNB" | "BEV" | "OTHER";

export const STATION_SEGMENT: Record<string, SalesSegmentCode> = {
  kitchen: "FNB",
  bakery: "FNB",
  dessert: "FNB",
  bar: "BEV",
  merchandise: "BEV",
  photobooth: "OTHER",
};

export const SEGMENT_LABELS: Record<SalesSegmentCode, string> = {
  FNB: "F&B",
  BEV: "Beverage",
  OTHER: "Others",
};

export function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function percentage(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function formatReportDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T12:00:00`) : value;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const day = date.getDate();
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  const year = date.getFullYear();
  return `${weekday}, ${String(day).padStart(2, "0")}${suffix} ${month} ${year}`;
}

export function formatReportTime(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

export function resolveSegment(station?: string | null): SalesSegmentCode {
  if (!station) return "OTHER";
  return STATION_SEGMENT[station] || "OTHER";
}

export function targetBlock(actual: number, target: number) {
  return {
    target: roundCurrency(target),
    actual: roundCurrency(actual),
    variance: roundCurrency(actual - target),
  };
}
