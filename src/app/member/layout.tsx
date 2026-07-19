import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal Member — Sulu Wonderland",
  description: "Cek saldo ARK Coin, XP, tier, dan riwayat transaksi Anda.",
};

/** Layout portal member — berdiri sendiri, tanpa chrome dashboard internal. */
export default function MemberPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-amber-50">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
        {children}
      </div>
    </div>
  );
}
