import type { Order } from "@/lib/pos-api";
import type {
  TransactionOrderDetail,
} from "@/features/pos/reports/components/transaction-detail-body";
import type { TransactionReportRow } from "@/features/pos/reports/types";

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type OrderWithReportFields = Order & {
  xendit_external_id?: string | null;
  xendit_qr_id?: string | null;
  warehouse_id?: string | null;
  stall_code?: string | null;
  stall_name?: string | null;
};

export function orderToTransactionRow(order: OrderWithReportFields): TransactionReportRow {
  return {
    id: order.id,
    order_number: order.order_number ?? null,
    ordered_at: order.ordered_at ?? null,
    status: order.status ?? null,
    payment_status: order.payment_status ?? null,
    payment_method: order.payment_method ?? null,
    payment_method_code: order.payment_method_code ?? null,
    payment_method_name: order.payment_method_name ?? null,
    subtotal: toNumber(order.subtotal),
    discount_amount: toNumber(order.discount_amount),
    tax_amount: toNumber(order.tax_amount),
    service_charge_amount: toNumber(order.service_charge_amount),
    total_amount: toNumber(order.total_amount),
    ark_coins_used: toNumber(order.ark_coins_used),
    cashier_id: order.cashier_id ?? null,
    warehouse_id: order.warehouse_id ?? null,
    stall_code: order.stall_code ?? null,
    stall_name: order.stall_name ?? null,
    checkout_id: order.checkout_id ?? null,
    checkout_number: order.checkout_number ?? null,
    sold_from: order.sold_from ?? null,
    xendit_qr_id: order.xendit_qr_id ?? null,
    xendit_external_id: order.xendit_external_id ?? null,
  };
}

export function mergeBillTransactionDetail(
  base: TransactionOrderDetail | null,
  orders: OrderWithReportFields[]
): TransactionOrderDetail {
  const primary = orders[0];
  const source = base ?? (primary as TransactionOrderDetail);
  if (orders.length <= 1) return source;

  const sum = (key: keyof Order) =>
    orders.reduce((total, order) => total + toNumber(order[key]), 0);

  return {
    ...source,
    checkout_number: source.checkout_number || primary?.checkout_number,
    subtotal: sum("subtotal"),
    discount_amount: sum("discount_amount"),
    tax_amount: sum("tax_amount"),
    service_charge_amount: sum("service_charge_amount"),
    total_amount: sum("total_amount"),
    amount_paid: sum("amount_paid"),
    change_amount: sum("change_amount"),
    ark_coins_used: sum("ark_coins_used"),
  };
}

export function flattenOrderItems(orders: Order[]) {
  return orders.flatMap((order) =>
    (order.items || []).map((item, index) => ({
      id: String(item.id || `${order.id}-${item.product_id || index}`),
      product_name: item.product_name,
      product_sku: item.product_sku,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_amount: item.total_amount,
      variants: item.variants,
      modifiers: item.modifiers,
    }))
  );
}
