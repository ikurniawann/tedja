import { requireIamPage } from "@/lib/auth/require-user";
import { IAM } from "@/lib/iam/prefixes";
import { ApiTokensPage } from "@/features/configuration/api-tokens/api-tokens-page";

export default async function ApiTokensSettingsPage() {
  await requireIamPage(IAM.settingsUsers);
  return <ApiTokensPage />;
}
