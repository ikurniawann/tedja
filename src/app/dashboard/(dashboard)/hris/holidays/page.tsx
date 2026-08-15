import { requireRole } from "@/lib/auth/require-user";
import { HolidaysPage } from "@/features/hris/holidays";

export default async function HrisHolidaysPage() {
  await requireRole(["super_admin", "hrd"]);
  return <HolidaysPage />;
}
