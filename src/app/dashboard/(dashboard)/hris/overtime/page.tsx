import { requireRole } from "@/lib/auth/require-user";
import { OvertimePage } from "@/features/hris/overtime";

// HRIS → Kepegawaian → Lembur: approval pengajuan + penugasan perusahaan.
export default async function HrisOvertimePage() {
  await requireRole(["super_admin", "admin", "hrd"]);
  return <OvertimePage />;
}
