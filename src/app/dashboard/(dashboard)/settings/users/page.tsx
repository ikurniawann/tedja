import { requireRole } from "@/lib/auth/require-user";
import { UsersListPage } from "@/features/users";

// Manajemen User (IAM) — akun login, role, reset password, buat akun.
// Terpisah dari direktori Karyawan (/dashboard/employees).
export default async function UserManagementPage() {
  await requireRole(["super_admin", "admin", "hrd"]);
  return <UsersListPage variant="accounts" />;
}
