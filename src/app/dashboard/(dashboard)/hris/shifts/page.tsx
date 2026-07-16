import { requireRole } from "@/lib/auth/require-user";
import { ShiftsPage } from "@/features/hris/shifts";

export default async function HrisShiftsPage() {
  await requireRole(["super_admin", "admin", "hrd"]);
  return <ShiftsPage />;
}
