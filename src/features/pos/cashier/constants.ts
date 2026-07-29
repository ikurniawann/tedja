export type CashierPageVariant = "embedded" | "fullscreen";

export const CASHIER_ROUTES = {
  embedded: "/dashboard/pos/cashier-new",
  fullscreen: "/dashboard/pos/cashier-fullscreen",
} as const;

/** Bookmark / home-screen friendly entry for tablet cashiers */
export const CASHIER_TABLET_ROUTE = "/dashboard/pos/tablet";

export const RESTAURANT_ROUTE = "/dashboard/pos/restaurant";

export function cashierRoute(
  variant: CashierPageVariant,
  searchParams?: URLSearchParams | string
) {
  const base = CASHIER_ROUTES[variant];
  if (!searchParams) return base;
  const query =
    typeof searchParams === "string" ? searchParams : searchParams.toString();
  return query ? `${base}?${query}` : base;
}
