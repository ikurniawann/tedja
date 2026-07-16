import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { RecruitmentDashboardPage } from "@/features/hris/dashboard";

export default async function Page() {
  const user = await requireUser();
  // Karyawan ESS tidak punya akses dashboard HR — langsung ke Area Karyawan
  if (user.role === "employee") redirect("/dashboard/me");
  return <RecruitmentDashboardPage />;
}
