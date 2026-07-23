import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { FunnelSettingsPage } from "@/features/sales-funnel/settings";

// Konfigurasi tahap = wewenang Super Admin. Role `sales` bisa mencapai
// prefix /dashboard/sales-funnel/* via ROLE_MODULE_PATHS, jadi halaman ini
// wajib guard sendiri (API PATCH stages juga menolak non-super_admin).
export default async function SalesFunnelSettingsRoute() {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/dashboard/sales-funnel/pipeline");
  }
  return <FunnelSettingsPage />;
}
