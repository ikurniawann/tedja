import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portal Member — Sulu in Wounderland",
  description: "Cek saldo ARK Coin, XP, tier, reward, dan riwayat transaksi Anda.",
};

/**
 * Layout portal member — berdiri sendiri, tanpa chrome dashboard internal.
 *
 * Kelas `member-portal` membawa token warna yang diturunkan dari brand
 * (--brand-primary), jadi portal tetap satu tema dengan dashboard dan ikut
 * berubah bila brand diganti dari ThemeProvider.
 */
export default function MemberPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="member-portal member-portal-bg min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-5">
        {children}
      </div>
    </div>
  );
}
