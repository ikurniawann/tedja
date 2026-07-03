import type { ItemsLookupRecord } from "@/lib/purchasing/items-lookup";

const LEGACY_CATEGORY_LABELS: Record<string, string> = {
  BAHAN_PANGAN: "Food Material",
  BAHAN_NON_PANGAN: "Non-Food Material",
  KEMASAN: "Packaging",
  BAHAN_BAKAR: "Fuel Material",
  LAINNYA: "Other",
};

export function toLookupOptions(records: ItemsLookupRecord[] | undefined) {
  return (records ?? [])
    .filter((row) => row.is_active)
    .map((row) => ({
      value: row.code,
      label: row.nama,
      description: row.deskripsi || undefined,
    }));
}

export function buildLookupLabelMap(records: ItemsLookupRecord[] | undefined) {
  const map = new Map<string, string>();
  for (const row of records ?? []) {
    map.set(row.code, row.nama);
  }
  return map;
}

export function resolveCategoryLabel(
  code: string | null | undefined,
  categoryMap?: Map<string, string>
) {
  if (!code) return "-";
  return categoryMap?.get(code) ?? LEGACY_CATEGORY_LABELS[code] ?? code.replace(/_/g, " ");
}

export function resolveStorageLabel(
  code: string | null | undefined,
  storageMap?: Map<string, string>
) {
  if (!code) return "-";
  return storageMap?.get(code) ?? code.replace(/_/g, " ");
}
