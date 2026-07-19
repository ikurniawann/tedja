import { requireRole } from "@/lib/auth/require-user";
import { WaGatewayPage } from "@/features/configuration/wa-gateway";

export default async function WaGatewaySettingsPage() {
  await requireRole(["super_admin"]);
  return <WaGatewayPage />;
}
