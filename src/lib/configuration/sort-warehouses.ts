/** Sort warehouses: default (Main Storage) first, then Stall 1, 2, … numerically. */
export function compareWarehouses(
  a: { is_default: boolean; code: string; name: string },
  b: { is_default: boolean; code: string; name: string }
): number {
  if (a.is_default !== b.is_default) {
    return a.is_default ? -1 : 1;
  }

  const stallNumber = (code: string) => {
    const match = code.trim().toUpperCase().match(/^STALL-0*(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  };

  const aStall = stallNumber(a.code);
  const bStall = stallNumber(b.code);

  if (aStall !== null && bStall !== null) {
    return aStall - bStall;
  }
  if (aStall !== null) return 1;
  if (bStall !== null) return -1;

  if (a.code.toUpperCase() === "MAIN") return -1;
  if (b.code.toUpperCase() === "MAIN") return 1;

  return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
    || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

export function sortWarehouses<T extends { is_default: boolean; code: string; name: string }>(
  warehouses: T[]
): T[] {
  return [...warehouses].sort(compareWarehouses);
}
