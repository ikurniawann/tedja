import type { Metadata } from "next";
import { NoxPortal } from "@/features/member-portal/nox/nox-portal";

/**
 * /member/nox — pratinjau portal member "Nox Lab" (Fase A).
 *
 * Rute terpisah dari /member supaya portal lama tetap utuh sebagai fallback
 * (keputusan owner 2026-08-15). Penggantian rute utama terjadi di Fase C
 * setelah data nyata (B) dan login OTP tersambung. Berada di bawah prefix
 * /member yang sudah publik di middleware — tidak butuh sesi user internal.
 */
export const metadata: Metadata = {
  title: "Nox Lab — Citizen Portal",
};

export default function MemberNoxPreviewPage() {
  return <NoxPortal />;
}
