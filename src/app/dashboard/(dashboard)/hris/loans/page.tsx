import { requireRole } from "@/lib/auth/require-user";
import { LoansPage } from "@/features/hris/loans";

// HRIS → Penggajian → Pinjaman: kasbon/pinjaman + approval + pelunasan.
export default async function HrisLoansPage() {
  await requireRole(["super_admin", "admin", "hrd", "finance_staff"]);
  return <LoansPage />;
}
