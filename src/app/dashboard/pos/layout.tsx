import { requireUser } from "@/lib/auth/require-user";
import { findFirstBackOfficeHref, getModuleMenus, getUserMenus } from "@/lib/iam/get-user-menus";
import { PosLayout } from "@/features/pos/layout";

export default async function PosDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const [items, navItems] = await Promise.all([
    getModuleMenus(user.id, user.role, "/dashboard/pos"),
    getUserMenus(user.id, user.role),
  ]);
  const backOfficeHref = findFirstBackOfficeHref(navItems) ?? "/arkiv-os";

  return (
    <PosLayout items={items} backOfficeHref={backOfficeHref}>
      {children}
    </PosLayout>
  );
}
