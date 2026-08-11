import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { requireUser } from "@/lib/auth/require-user";
import {
  collectNavHrefs,
  getUserMenus,
  filterNavByPrefixes,
  isEssOnlyUser,
} from "@/lib/iam/get-user-menus";
import {
  allowedModulePaths,
  canAccessPath,
  isFullAccessRole,
  isPathAllowedByMenus,
  ESS_HOME_PATH,
} from "@/lib/iam/access";
import { AppSidebar } from "@/components/shared";

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Kebijakan ESS-only ditentukan IAM (permission menu non-ESS), bukan daftar role di kode.
  const essOnly = await isEssOnlyUser(user.id, user.role);
  const allNavItems = await getUserMenus(user.id, user.role);

  // Guard path utk SEMUA role non-full-access (fix H1 security review
  // EPIC-032 A4 — sebelumnya hanya essOnly, sehingga role ber-grant menu
  // non-ESS seperti sales/finance_staff/marketing bisa membuka URL modul
  // lain langsung). Path sah = ESS / ROLE_MODULE_PATHS / href menu IAM
  // ber-grant (root "/dashboard" exact-only). POS punya layout sendiri di
  // luar group ini — tidak tersentuh.
  if (!isFullAccessRole(user.role)) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    const allowed =
      !pathname ||
      canAccessPath(user.role, pathname) ||
      isPathAllowedByMenus(pathname, collectNavHrefs(allNavItems));
    if (!allowed) {
      redirect(
        essOnly
          ? ESS_HOME_PATH
          : (allowedModulePaths(user.role)[0] ?? ESS_HOME_PATH)
      );
    }
  }
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
        branch_id: user.branch_id,
        branch_name: user.branch_name,
        warehouse_name: user.warehouse_name,
        active_stall_id: user.active_stall_id,
        can_switch_stall: user.can_switch_stall,
      }}
      navItems={navItems}
      essOnly={essOnly}
    >
      {children}
      <Toaster position="bottom-right" />
    </AppSidebar>
  );
}
