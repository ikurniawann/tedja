import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { ExecutiveDashboardPage } from "@/features/dashboard/executive";

/**
 * Landing /dashboard (EPIC-021, keputusan owner 2026-07-21):
 * - super_admin + direksi → Ringkasan Eksekutif lintas modul.
 * - employee → Area Karyawan (aturan lama dipertahankan).
 * - role lain → dashboard rekrutmen di alamat barunya, persis konten yang
 *   mereka lihat sebelum halaman ini berganti isi.
 */
export default async function Page() {
  const user = await requireUser();
  if (user.role === "employee") redirect("/dashboard/me");
  if (user.role === "super_admin" || user.role === "direksi") {
    return <ExecutiveDashboardPage />;
  }
  redirect("/dashboard/rekrutmen");
}
