import { redirect } from "next/navigation";

// ESS dipecah menjadi /dashboard/me/absensi dan /dashboard/me/cuti.
export default function MePage() {
  redirect("/dashboard/me/absensi");
}
