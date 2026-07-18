import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { requireUser } from "@/lib/auth/require-user";
import { getUserMenus, filterEssNav } from "@/lib/iam/get-user-menus";
import { isEssOnlyRole, isEssPath } from "@/lib/iam/access";
import { AppSidebar } from "@/components/shared";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const essOnly = isEssOnlyRole(user.role);

  // Role ESS-only dikunci ke Area Karyawan: URL modul lain → balik ke beranda.
  if (essOnly) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && !isEssPath(pathname)) {
      redirect("/dashboard/me");
    }
  }

  const allNavItems = await getUserMenus(user.id, user.role);
  // ESS-only: hanya menu Area Karyawan. Full-access: buang "Beranda" ESS
  // (/dashboard/me) agar tak ganda dengan Beranda utama (/dashboard).
  const navItems = essOnly
    ? filterEssNav(allNavItems)
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
