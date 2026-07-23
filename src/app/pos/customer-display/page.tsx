import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { CustomerDisplayPage } from "@/features/pos/cfd";

// EPIC-024 — layar customer FULLSCREEN murni: sengaja di LUAR layout
// /dashboard/pos (App Router tidak bisa opt-out layout induk) supaya
// tanpa sidebar/navbar. Guard role = pemegang menu Kasir.
const OPERATOR_ROLES = [
  "super_admin",
  "admin",
  "pos",
  "pos_supervisor",
  "sulu_bandung_demo",
];

export default async function Page() {
  const user = await requireUser();
  if (!OPERATOR_ROLES.includes(user.role)) {
    redirect("/dashboard");
  }
  return <CustomerDisplayPage />;
}
