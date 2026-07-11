export type HelpRole =
  | "kasir"
  | "supervisor"
  | "kepala_cabang"
  | "direksi"
  | "default";

type HelpEntry = Partial<Record<HelpRole, string>> & { default: string };

const HELP: Record<string, HelpEntry> = {
  "pos.shift": {
    default:
      "Buka shift sebelum bertransaksi. Semua penjualan Anda tercatat di bawah shift ini.",
    supervisor:
      "Pantau shift kasir aktif. Shift wajib dibuka sebelum transaksi dan ditutup saat tutup kasir.",
  },
  "pos.void": {
    default: "Membatalkan pesanan. Butuh otorisasi supervisor.",
    supervisor:
      "Masukkan PIN supervisor Anda untuk menyetujui pembatalan pesanan ini.",
    kepala_cabang:
      "Void memerlukan PIN supervisor; seluruh void tercatat di laporan untuk audit.",
  },
  "pos.split-bill": {
    default: "Pisahkan satu tagihan menjadi beberapa pembayaran terpisah.",
  },
  "pos.tax-toggle": {
    default: "Aktifkan/nonaktifkan pajak 10% pada transaksi ini.",
  },
  "pos.discount": {
    default:
      "Diskon otomatis mengikuti tier member (Silver 5%, Gold 10%, Platinum 15%).",
  },
  "report.closing.net-sales": {
    default: "Penjualan bersih = kotor − diskon − pajak − service charge.",
    kepala_cabang:
      "Bandingkan penjualan bersih terhadap target harian & bulanan cabang di bagian bawah laporan.",
    direksi:
      "Penjualan bersih lintas cabang menjadi dasar analisis margin di laporan profit.",
  },
};

export function getHelpText(helpId: string, role: HelpRole): string | null {
  const entry = HELP[helpId];
  if (!entry) return null;
  return entry[role] ?? entry.default;
}
