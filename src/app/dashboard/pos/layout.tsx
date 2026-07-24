import { Toaster } from "sonner";
import { requireUser } from "@/lib/auth/require-user";
import { getUserMenus, isEssOnlyUser } from "@/lib/iam/get-user-menus";
import { AppSidebar } from "@/components/shared";

export default async function PosDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const [navItems, essOnly] = await Promise.all([
    getUserMenus(user.id, user.role),
    isEssOnlyUser(user.id, user.role),
  ]);

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
      }}
      navItems={navItems}
      essOnly={essOnly}
    >
      {children}
      <Toaster position="bottom-right" />
    </AppSidebar>
  );
}
