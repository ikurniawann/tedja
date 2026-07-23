import { requireRole } from "@/lib/auth/require-user";
import { VoiceSettingsPage } from "@/features/configuration/voice";

export default async function VoiceSettingsRoute() {
  await requireRole(["super_admin", "admin"]);
  return <VoiceSettingsPage />;
}
