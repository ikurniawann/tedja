import { requireRole } from "@/lib/auth/require-user";
import { ShopOrdersPage } from "@/features/shop/orders";

export default async function ShopOrdersRoute() {
  await requireRole(["super_admin", "admin"]);
  return <ShopOrdersPage />;
}
