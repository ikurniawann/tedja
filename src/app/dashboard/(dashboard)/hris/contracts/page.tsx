import { requireRole } from "@/lib/auth/require-user";
import { ContractsListPage } from "@/features/hris/contracts";

// HRIS → Kontrak: daftar kontrak karyawan yang akan segera berakhir
// (filter rentang/tipe/status + sort per kolom).
export default async function HrisContractsPage() {
  await requireRole(["super_admin", "admin", "hrd"]);
  return <ContractsListPage />;
}
