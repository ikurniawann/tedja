import { requireUser } from "@/lib/auth/require-user";
import { EssPage } from "@/features/hris/ess";

// ESS (Employee Self-Service) — semua akun boleh masuk; halaman menangani
// sendiri akun yang tidak tertaut record karyawan.
export default async function MePage() {
  await requireUser();
  return <EssPage />;
}
