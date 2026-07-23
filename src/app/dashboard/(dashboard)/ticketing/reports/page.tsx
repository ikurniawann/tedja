import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { TicketingReportsPage } from "@/features/ticketing/reports";

// Laporan = wewenang admin/supervisor; kasir 'pos' tidak perlu laporan
const REPORT_ROLES = ["super_admin", "pos_supervisor"];

export default async function TicketingReportsRoute() {
  const user = await requireUser();
  if (!REPORT_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  return <TicketingReportsPage />;
}
