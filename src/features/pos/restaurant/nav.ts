import { CASHIER_ROUTES } from "@/features/pos/cashier/constants";

export const RESTAURANT_FROM = "restaurant";
export const RESTAURANT_PATH = "/dashboard/pos/restaurant";
export const RESTAURANT_IMMERSIVE_PARAM = "immersive";

type SearchParamsLike = { get(name: string): string | null };

export function isRestaurantImmersive(searchParams: SearchParamsLike): boolean {
  return searchParams.get(RESTAURANT_IMMERSIVE_PARAM) === "1";
}

export function restaurantPath(opts?: { immersive?: boolean }): string {
  if (opts?.immersive) {
    return `${RESTAURANT_PATH}?${RESTAURANT_IMMERSIVE_PARAM}=1`;
  }
  return RESTAURANT_PATH;
}

export function buildCashierHandoffUrl(opts: {
  tableId?: string;
  orderId?: string;
  orderType?: "dine_in" | "takeaway";
  pay?: boolean;
  immersive?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("from", RESTAURANT_FROM);
  if (opts.tableId) params.set("tableId", opts.tableId);
  if (opts.orderId) params.set("orderId", opts.orderId);
  if (opts.orderType) params.set("orderType", opts.orderType);
  if (opts.pay) params.set("pay", "1");
  if (opts.immersive) params.set(RESTAURANT_IMMERSIVE_PARAM, "1");

  return `${CASHIER_ROUTES.embedded}?${params.toString()}`;
}
