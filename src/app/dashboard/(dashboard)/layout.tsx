import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { requireUser } from "@/lib/auth/require-user";
import { getUserMenus, filterNavByPrefixes } from "@/lib/iam/get-user-menus";
import {
  allowedModulePaths,
  canAccessPath,
  ESS_HOME_PATH,
  isEssOnlyRole,
} from "@/lib/iam/access";
import { AppSidebar } from "@/components/shared";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const essOnly = isEssOnlyRole(user.role);

  // Role ESS-only dikunci ke Area Karyawan + modul tambahannya (mis. sales →
  // Sales Funneling): URL di luar itu → balik ke beranda ESS.
  if (essOnly) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && !canAccessPath(user.role, pathname)) {
      redirect(ESS_HOME_PATH);
    }
  }

  const allNavItems = await getUserMenus(user.id, user.role);
  // ESS-only: menu Area Karyawan + modul tambahan role. Full-access: buang
  // "Beranda" ESS (/dashboard/me) agar tak ganda dengan Beranda utama.
  const navItems = essOnly
    ? filterNavByPrefixes(allNavItems, [
        ESS_HOME_PATH,
        ...allowedModulePaths(user.role),
      ])
    : allNavItems.filter((item) => item.href !== "/dashboard/me");

  return (
    <AppSidebar
      user={{
        full_name: user.full_name,
        role: user.role,
        email: user.email,
        company_name: user.company_name,
        branch_name: user.branch_name,
      }}
      navItems={navItems}
    >
      {children}
      <Toaster position="bottom-right" />
    </AppSidebar>
  );
}
