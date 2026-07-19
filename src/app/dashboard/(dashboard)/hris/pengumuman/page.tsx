import { requireRole } from "@/lib/auth/require-user";
import { AnnouncementsPage } from "@/features/hris/announcements";

// HRIS → Kepegawaian → Pengumuman: CMS pengumuman perusahaan.
export default async function HrisPengumumanPage() {
  await requireRole(["super_admin", "admin", "hrd"]);
  return <AnnouncementsPage />;
}
