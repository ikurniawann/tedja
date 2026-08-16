/** Every pos_orders row is stall revenue. Never add pos_checkouts totals. */
export function isRevenueOrder(_order: { checkout_id?: string | null }): boolean {
  return true;
}
