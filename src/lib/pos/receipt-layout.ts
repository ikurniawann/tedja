export function groupCartItemsByStallName<
  T extends { warehouse_name?: string | null; warehouse_id?: string | null },
>(items: T[]): Array<{ stallName: string; items: T[] }> {
  const groups: Array<{ stallName: string; items: T[] }> = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = item.warehouse_id || item.warehouse_name?.trim() || "Stall";
    const stallName = item.warehouse_name?.trim() || "Stall";
    const existing = indexByKey.get(key);
    if (existing != null) {
      groups[existing]?.items.push(item);
      continue;
    }
    indexByKey.set(key, groups.length);
    groups.push({ stallName, items: [item] });
  }
  return groups;
}

export function receiptDocumentLabel(payload: {
  checkoutNumber?: string | null;
  orderNumber?: string | null;
  orderId?: string | null;
}): string {
  if (payload.checkoutNumber) {
    return `Checkout #${payload.checkoutNumber}`;
  }
  const tail =
    (payload.orderNumber || "").slice(-8).toUpperCase() ||
    (payload.orderId || "").slice(-8).toUpperCase();
  return `Order #${tail}`;
}

export type ReceiptLineItem = {
  name: string;
  quantity: number;
  variantName?: string;
  modifierNames?: string[];
  notes?: string;
  warehouse_name?: string | null;
  warehouse_id?: string | null;
};

export function buildReceiptItemLines(
  items: ReceiptLineItem[]
): Array<{ text: string; align: "left" | "center" }> {
  const groups = groupCartItemsByStallName(items);
  const showHeaders = groups.length >= 2;
  const lines: Array<{ text: string; align: "left" | "center" }> = [];
  for (const group of groups) {
    if (showHeaders) {
      lines.push({ text: `--- ${group.stallName} ---`, align: "center" });
    }
    for (const item of group.items) {
      lines.push({ text: `${item.quantity}x ${item.name}`, align: "left" });
      if (item.variantName) lines.push({ text: `  ${item.variantName}`, align: "left" });
      if (item.modifierNames?.length) {
        lines.push({ text: `  ${item.modifierNames.join(", ")}`, align: "left" });
      }
      if (item.notes) lines.push({ text: `  * ${item.notes}`, align: "left" });
    }
  }
  return lines;
}
