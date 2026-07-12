export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

export function isPlaced(
  pos_x: number | null | undefined,
  pos_y: number | null | undefined
): boolean {
  return (
    pos_x != null &&
    pos_y != null &&
    Number.isFinite(pos_x) &&
    Number.isFinite(pos_y)
  );
}

/** Client-only initial layout for tables that have never been dragged. */
export function assignGridPositions(
  ids: string[],
  cols = 6
): Record<string, { pos_x: number; pos_y: number }> {
  const out: Record<string, { pos_x: number; pos_y: number }> = {};
  const startX = 4;
  const startY = 4;
  const stepX = 14;
  const stepY = 16;
  ids.forEach((id, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    out[id] = {
      pos_x: clampPercent(startX + col * stepX),
      pos_y: clampPercent(startY + row * stepY),
    };
  });
  return out;
}
