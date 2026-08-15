export type TableSaleKind = "stall" | "central_mixed" | "central_single";

export type TableSaleTarget =
  | { action: "create_order" }
  | { action: "create_checkout" }
  | { action: "append_checkout"; checkoutId: string };

export const CONTINUE_OPEN_BILL_MESSAGE = "Lanjutkan open bill di meja ini";

export type TableBillFamily = {
  checkout_id?: string | null;
  sold_from?: string | null;
};

export type CheckoutAppendChild =
  | { action: "append"; orderId: string; warehouseId: string }
  | { action: "create_child"; warehouseId: string };

/**
 * Where a new table sale should land.
 * Stall cashier always opens a fresh pos_orders row.
 * Kasir pusat (mixed or 1-stall) appends only to an existing unpaid central
 * checkout — never to a stall order, and never to a paid checkout.
 */
export function resolveTableSaleTarget(input: {
  saleKind: TableSaleKind;
  unpaidCentralCheckoutId?: string | null;
}): TableSaleTarget {
  if (input.saleKind === "stall") {
    return { action: "create_order" };
  }

  const checkoutId = input.unpaidCentralCheckoutId || null;
  if (checkoutId) {
    return { action: "append_checkout", checkoutId };
  }
  if (input.saleKind === "central_mixed") {
    return { action: "create_checkout" };
  }
  return { action: "create_order" };
}

export function isCentralBill(order: TableBillFamily) {
  return Boolean(order.checkout_id) || order.sold_from === "central";
}

/** Move-items may land on an occupied table, but must not merge stall ↔ central. */
export function canAppendTransferItems(
  source: TableBillFamily,
  target: TableBillFamily
) {
  return isCentralBill(source) === isCentralBill(target);
}

/** Merge uses the same family gate; mixed-family destinations are blocked. */
export function canMergeIntoDestination(
  source: TableBillFamily,
  destOrders: TableBillFamily[]
) {
  if (destOrders.length === 0) return false;
  const families = new Set(destOrders.map((order) => isCentralBill(order)));
  if (families.size > 1) return false;
  return destOrders.every((order) => canAppendTransferItems(source, order));
}

export function planCheckoutAppend(input: {
  incomingWarehouseIds: string[];
  existingCentralChildren: Array<{ id: string; warehouse_id: string | null }>;
  tableOrders?: Array<{
    id: string;
    warehouse_id?: string | null;
    checkout_id?: string | null;
    sold_from?: string | null;
  }>;
}): {
  children: CheckoutAppendChild[];
  untouchedStallOrderIds: string[];
} {
  const childByWarehouse = new Map(
    input.existingCentralChildren.map((row) => [
      String(row.warehouse_id || ""),
      row.id,
    ])
  );
  const children: CheckoutAppendChild[] = [];
  for (const warehouseId of input.incomingWarehouseIds) {
    const orderId = childByWarehouse.get(warehouseId);
    if (orderId) {
      children.push({ action: "append", orderId, warehouseId });
    } else {
      children.push({ action: "create_child", warehouseId });
    }
  }
  const untouchedStallOrderIds = (input.tableOrders ?? [])
    .filter((order) => !isCentralBill(order))
    .map((order) => order.id);
  return { children, untouchedStallOrderIds };
}

export function resolvePaidMixedOnOccupiedTable(input: {
  unpaidCentralCheckoutId?: string | null;
}): { action: "reject"; message: string } | { action: "create" } {
  if (input.unpaidCentralCheckoutId) {
    return { action: "reject", message: CONTINUE_OPEN_BILL_MESSAGE };
  }
  return { action: "create" };
}
