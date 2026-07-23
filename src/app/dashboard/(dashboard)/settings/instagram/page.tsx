import { requireRole } from "@/lib/auth/require-user";
import { InstagramSettingsPage } from "@/features/configuration/instagram";

export default async function InstagramSettingsRoute() {
  await requireRole(["super_admin"]);
  return <InstagramSettingsPage />;
}
