import { requireRole } from "@/lib/auth/require-user";
import { ShippingSettingsPage } from "@/features/shop/shipping-settings";

export default async function ShippingSettingsRoute() {
  await requireRole(["super_admin", "admin"]);
  return <ShippingSettingsPage />;
}
