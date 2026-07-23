import { requireRole } from "@/lib/auth/require-user";
import { CrmReviewsPage } from "@/features/crm/reviews";

export default async function ReviewsPage() {
  await requireRole(["super_admin", "admin", "pos_supervisor"]);
  return <CrmReviewsPage />;
}
