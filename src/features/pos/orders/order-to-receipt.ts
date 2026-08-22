import type { ReceiptPayload } from "@/components/pos/PrintReceipt";
import type { PosCartItem } from "@/hooks/use-pos-cart";
import type { Order } from "@/features/pos/orders/types";

function asNamedList(value: unknown): Array<{ name?: string }> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is { name?: string } => entry != null && typeof entry === "object");
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).filter(
      (entry): entry is { name?: string } => entry != null && typeof entry === "object",
    );
  }
  return [];
}

/** Map list/detail order row into the shared thermal receipt payload. */
export function orderToReceiptPayload(order: Order): ReceiptPayload {
  const items: PosCartItem[] = (order.items || []).map((item, index) => {
    const row = item as {
      product_id?: string;
      product_name?: string;
      quantity?: number;
      unit_price?: number;
      total_amount?: number;
      station?: string;
      kitchen_notes?: string;
      notes?: string;
      variants?: unknown;
      modifiers?: unknown;
    };
    const qty = Number(row.quantity) || 0;
    const lineTotal = Number(row.total_amount);
    const unit = Number(row.unit_price);
    const price =
      Number.isFinite(unit) && unit > 0
        ? unit
        : qty > 0 && Number.isFinite(lineTotal)
          ? lineTotal / qty
          : 0;

    const variants = asNamedList(row.variants);
    const modifiers = asNamedList(row.modifiers);
    const modifierNames = modifiers
      .map((m) => m.name)
      .filter((name): name is string => Boolean(name));

    return {
      id: `${row.product_id || "item"}-${index}`,
      productId: row.product_id || "",
      name: row.product_name || "Item",
      price,
      quantity: qty,
      notes: row.kitchen_notes || row.notes,
      variantName: variants[0]?.name,
      modifierNames: modifierNames.length > 0 ? modifierNames : undefined,
      station: row.station,
    };
  });

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    queueNumber: order.queue_number,
    orderType: order.order_type || "dine_in",
    table: order.table?.table_number || null,
    items,
    notes: order.notes || "",
    total: Number(order.total_amount) || 0,
    change: Number(order.change_amount) || 0,
    paymentMethod: order.payment_method || "unpaid",
    customerName: order.customer?.name,
    discountAmount: Number(order.discount_amount) || 0,
    taxAmount: Number(order.tax_amount) || 0,
    chargesBreakdown: order.charges_breakdown || undefined,
    // EPIC-041: reprint memuat ARK terpakai dari baris order. Sisa saldo,
    // XP, dan total XP SENGAJA tidak diisi — semuanya snapshot saat bayar
    // (XP hidup di pos_xp_transactions, bukan kolom order), dan struk
    // reprint tidak boleh menebak nilai historis.
    arkPaid: Number((order as { ark_coins_used?: number | string }).ark_coins_used) || 0,
  };
}
