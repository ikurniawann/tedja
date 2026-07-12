export type CashierPageVariant = "embedded" | "fullscreen";

export const CASHIER_ROUTES = {
  embedded: "/dashboard/pos/cashier-new",
  fullscreen: "/dashboard/pos/cashier-fullscreen",
} as const;

export const RESTAURANT_ROUTE = "/dashboard/pos/restaurant";
