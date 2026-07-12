export type MoveDestinationTable = {
  id: string;
  status?: string | null;
  is_active?: boolean | null;
};

export function canPickMoveDestination(
  table: MoveDestinationTable,
  opts: { sourceTableId?: string | null }
): boolean {
  if (opts.sourceTableId && table.id === opts.sourceTableId) return false;
  if (table.is_active === false) return false;
  return String(table.status || "").toLowerCase() === "available";
}
