import { Toaster } from "sonner";
import { requireUser } from "@/lib/auth/require-user";
import { getUserMenus } from "@/lib/iam/get-user-menus";
import { AppSidebar } from "@/components/shared";

export default async function PosDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const navItems = await getUserMenus(user.id, user.role);

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
