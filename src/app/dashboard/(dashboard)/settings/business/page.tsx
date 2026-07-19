import { requireRole } from "@/lib/auth/require-user";
import { BusinessConfigurationPage } from "@/features/configuration/business";
import { CompanyProfileCard } from "@/features/configuration/business/components/company-profile-card";

export default async function BusinessSettingsPage() {
  await requireRole(["super_admin", "admin"]);
  return (
    <div className="space-y-6">
      <BusinessConfigurationPage />
      <CompanyProfileCard />
    </div>
  );
}
