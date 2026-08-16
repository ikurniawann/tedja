import { formatReceiptRow } from "@/lib/pos/thermal-escpos";

export function groupCartItemsByStallName<
  T extends {
    warehouse_name?: string | null;
    warehouse_id?: string | null;
    stallName?: string | null;
  },
>(items: T[]): Array<{ stallName: string; items: T[] }> {
  const groups: Array<{ stallName: string; items: T[] }> = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const stallName =
      item.warehouse_name?.trim() || item.stallName?.trim() || "Stall";
    const key = item.warehouse_id || stallName;
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
  price?: number;
  variantName?: string;
  modifierNames?: string[];
  notes?: string;
  warehouse_name?: string | null;
  warehouse_id?: string | null;
  stallName?: string | null;
};

function formatReceiptCurrency(n: number) {
  return "Rp " + new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(Math.abs(n));
}

export function buildReceiptItemLines(
  items: ReceiptLineItem[],
  options?: { withPrices?: boolean; headerStallName?: string | null }
): Array<{ text: string; align: "left" | "center" }> {
  const withPrices = Boolean(options?.withPrices);
  const headerStall = String(options?.headerStallName || "").trim();
  const groups = groupCartItemsByStallName(items);
  const showHeaders = groups.length >= 2;
  const lines: Array<{ text: string; align: "left" | "center" }> = [];
  for (const group of groups) {
    if (showHeaders) {
      lines.push({ text: `--- ${group.stallName} ---`, align: "center" });
    }
    for (const item of group.items) {
      const qty = Number(item.quantity) || 0;
      const unit = Number(item.price) || 0;
      if (withPrices) {
        lines.push({
          text: formatReceiptRow(`${item.quantity}x ${item.name}`, formatReceiptCurrency(unit * qty)),
          align: "left",
        });
        if (qty > 1) {
          lines.push({ text: `  @ ${formatReceiptCurrency(unit)}`, align: "left" });
        }
      } else {
        lines.push({ text: `${item.quantity}x ${item.name}`, align: "left" });
      }
      const itemStall = item.stallName?.trim() || "";
      if (itemStall && itemStall !== headerStall) {
        lines.push({ text: `  [${itemStall}]`, align: "left" });
      }
      if (item.variantName) lines.push({ text: `  ${item.variantName}`, align: "left" });
      if (item.modifierNames?.length) {
        lines.push({ text: `  ${item.modifierNames.join(", ")}`, align: "left" });
      }
      if (item.notes) lines.push({ text: `  * ${item.notes}`, align: "left" });
    }
  }
  return lines;
}
