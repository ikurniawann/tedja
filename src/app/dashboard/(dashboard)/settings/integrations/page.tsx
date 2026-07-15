import { requireRole } from "@/lib/auth/require-user";
import { IntegrationsPage } from "@/features/configuration/integrations";

export default async function IntegrationsSettingsPage() {
  await requireRole(["super_admin", "admin"]);
  return <IntegrationsPage />;
}
