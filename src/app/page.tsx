import ArkivOsDesktop from "@/components/arkiv/arkiv-os-desktop";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/require-user";
import { isEssOnlyRole } from "@/lib/iam/access";

export default async function HomePage() {
  const { user } = await getUser();

  if (!user) {
    redirect("/login");
  }
  // Role ESS-only tidak punya desktop Arkiv OS → langsung ke Area Karyawan.
  if (isEssOnlyRole(user.role)) {
    redirect("/dashboard/me");
  }

  return <ArkivOsDesktop />;
}
