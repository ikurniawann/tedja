import { requireRole } from "@/lib/auth/require-user";
import { ShopMarketplacePage } from "@/features/shop/marketplace";

export default async function ShopMarketplaceRoute() {
  await requireRole(["super_admin", "admin"]);
  return <ShopMarketplacePage />;
}
