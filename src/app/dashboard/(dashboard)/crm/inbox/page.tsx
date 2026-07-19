import { requireRole } from "@/lib/auth/require-user";
import { CrmInboxPage } from "@/features/crm/inbox";

export default async function InboxPage() {
  await requireRole(["super_admin", "admin", "pos_supervisor"]);
  return <CrmInboxPage />;
}
