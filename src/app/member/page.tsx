import { NoxPortal } from "@/features/member-portal/nox/nox-portal";

/**
 * /member — portal member "Nox Lab" (rute utama sejak Fase C).
 * Portal lama tetap hidup di /member/classic sebagai fallback.
 */
export default function Page() {
  return <NoxPortal />;
}
