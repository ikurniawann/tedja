import ArkivOsDesktop from "@/components/arkiv/arkiv-os-desktop";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/require-user";
import { isEssOnlyUser } from "@/lib/iam/get-user-menus";

export default async function ArkivOsPage() {
  // Pengunjung belum login tetap boleh melihat desktop (public landing);
  // tapi akun ESS-only (per IAM) yang sudah login dilempar ke Area Karyawan.
  const { user } = await getUser();
  if (user && (await isEssOnlyUser(user.id, user.role))) {
    redirect("/dashboard/me");
  }

  return <ArkivOsDesktop />;
}
