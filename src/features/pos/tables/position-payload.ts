import { clampPercent } from "./floor-layout";

export function parsePositionPayload(
  body: unknown
): { data: { pos_x: number; pos_y: number } } | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Payload posisi tidak valid" };
  }
  const record = body as Record<string, unknown>;
  const x = Number(record.pos_x);
  const y = Number(record.pos_y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { error: "pos_x dan pos_y wajib angka" };
  }
  return { data: { pos_x: clampPercent(x), pos_y: clampPercent(y) } };
}
