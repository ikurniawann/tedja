import { MemberPortalPage } from "@/features/member-portal/components/member-portal-page";

/**
 * /member/classic — portal member lama (kartu-kartu ringkas).
 *
 * Dipertahankan sebagai fallback setelah /member digantikan portal Nox
 * (keputusan owner 2026-08-15): kalau Nox bermasalah di perangkat tertentu,
 * member tetap punya jalan masuk yang terbukti bekerja.
 */
export default function Page() {
  return <MemberPortalPage />;
}
