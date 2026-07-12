import { CASHIER_ROUTES } from "@/features/pos/cashier/constants";

export const RESTAURANT_FROM = "restaurant";
export const RESTAURANT_PATH = "/dashboard/pos/restaurant";

export function buildCashierHandoffUrl(opts: {
  tableId?: string;
  orderId?: string;
  orderType?: "dine_in" | "takeaway";
  pay?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("from", RESTAURANT_FROM);
  if (opts.tableId) params.set("tableId", opts.tableId);
  if (opts.orderId) params.set("orderId", opts.orderId);
  if (opts.orderType) params.set("orderType", opts.orderType);
  if (opts.pay) params.set("pay", "1");

  return `${CASHIER_ROUTES.embedded}?${params.toString()}`;
}
