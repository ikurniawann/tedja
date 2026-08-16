import { Toaster } from "sonner";
import { requireUser, type AuthUser } from "@/lib/auth/require-user";
import { getUserMenus, isEssOnlyUser } from "@/lib/iam/get-user-menus";
import type { NavItem } from "@/lib/iam/types";
import { AppSidebar } from "@/components/shared";
import { LayoutLoadError } from "@/components/layout-load-error";
import { getSafeErrorMessage, isNextControlFlowError } from "@/lib/next-control-flow";

export default async function PosDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: AuthUser;
  let navItems: NavItem[];
  let essOnly: boolean;
  try {
    user = await requireUser();
    [navItems, essOnly] = await Promise.all([
      getUserMenus(user.id, user.role),
      isEssOnlyUser(user.id, user.role),
    ]);
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    console.error("[pos-layout]", error);
    return (
      <LayoutLoadError
        title="Gagal memuat POS"
        message={getSafeErrorMessage(error, "Tidak bisa memuat sesi atau menu.")}
      />
    );
  }

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
        can_central_checkout: user.can_central_checkout,
        has_central_cashier_menu: user.has_central_cashier_menu,
      }}
      navItems={navItems}
      essOnly={essOnly}
    >
      {children}
      <Toaster position="bottom-right" />
    </AppSidebar>
  );
}
