export type TableBoardActiveOrder = {
  payment_status?: string | null;
  pre_settled_at?: string | null;
} | null;

export type TableBoardStatusInput = {
  /** Master / DB status when no active order drives the board */
  tableStatus?: string | null;
  activeOrder?: TableBoardActiveOrder;
};

/**
 * Restaurant denah display status.
 * - available (green): no active order
 * - occupied (orange): active order, not pre-settled
 * - billing (red): pre-settled, awaiting payment
 * - reserved / maintenance: pass-through when idle
 */
export function resolveTableBoardStatus(input: TableBoardStatusInput): string {
  const order = input.activeOrder;
  if (order) {
    if (order.pre_settled_at) return "billing";
    return "occupied";
  }

  const raw = String(input.tableStatus || "available").toLowerCase();
  if (raw === "reserved" || raw === "maintenance") return raw;
  return "available";
}
