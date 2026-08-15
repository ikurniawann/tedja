export type TableSaleKind = "stall" | "central_mixed" | "central_single";

export type TableSaleTarget =
  | { action: "create_order" }
  | { action: "create_checkout" }
  | { action: "append_checkout"; checkoutId: string };

/**
 * Where a new table sale should land.
 * Stall cashier always opens a fresh pos_orders row.
 * Kasir pusat mixed appends only to an existing unpaid central checkout —
 * never to a stall order, and never to a paid checkout.
 */
export function resolveTableSaleTarget(input: {
  saleKind: TableSaleKind;
  unpaidCentralCheckoutId?: string | null;
}): TableSaleTarget {
  if (input.saleKind === "stall" || input.saleKind === "central_single") {
    return { action: "create_order" };
  }

  const checkoutId = input.unpaidCentralCheckoutId || null;
  if (checkoutId) {
    return { action: "append_checkout", checkoutId };
  }
  return { action: "create_checkout" };
}

export function isCentralBill(order: {
  checkout_id?: string | null;
  sold_from?: string | null;
}) {
  return Boolean(order.checkout_id) || order.sold_from === "central";
}

/** Move-items may land on an occupied table, but must not merge stall ↔ central. */
export function canAppendTransferItems(
  source: { checkout_id?: string | null; sold_from?: string | null },
  target: { checkout_id?: string | null; sold_from?: string | null }
) {
  return isCentralBill(source) === isCentralBill(target);
}
