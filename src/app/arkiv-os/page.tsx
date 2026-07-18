import ArkivOsDesktop from "@/components/arkiv/arkiv-os-desktop";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/require-user";
import { isEssOnlyRole } from "@/lib/iam/access";

export default async function ArkivOsPage() {
  // Pengunjung belum login tetap boleh melihat desktop (public landing);
  // tapi akun ESS-only yang sudah login dilempar ke Area Karyawan.
  const { user } = await getUser();
  if (user && isEssOnlyRole(user.role)) {
    redirect("/dashboard/me");
  }

  return <ArkivOsDesktop />;
}
