export const FLOOR_PRESETS = [
  { value: "B", label: "Basement" },
  { value: "GF", label: "Ground Floor" },
  { value: "1", label: "Floor 1" },
  { value: "2", label: "Floor 2" },
  { value: "3", label: "Floor 3" },
  { value: "4", label: "Floor 4" },
  { value: "5", label: "Floor 5" },
] as const;

export const FLOOR_LABEL: Record<string, string> = Object.fromEntries(
  FLOOR_PRESETS.map((o) => [o.value, o.label])
);

export const FLOOR_ORDER = FLOOR_PRESETS.map((o) => o.value);

export function floorLabel(floor: string | null | undefined): string {
  const key = String(floor ?? "").trim();
  if (!key) return "Unassigned";
  return FLOOR_LABEL[key] || key;
}

export function floorSortKey(floor: string | null | undefined): number {
  const key = String(floor ?? "").trim();
  if (!key) return 999;
  const idx = FLOOR_ORDER.indexOf(key as (typeof FLOOR_ORDER)[number]);
  return idx === -1 ? 500 : idx;
}
