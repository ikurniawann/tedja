import type { DesktopOverview } from "./overview";

/**
 * Pertanyaan "Tanya Do" berkonteks per widget (EPIC-019 Fase D).
 *
 * Pertanyaan dibentuk dari ANGKA yang sedang tampil — bukan template statis —
 * supaya Do langsung menjawab kondisi yang dilihat owner (mis. "kenapa omzet
 * turun 35% dibanding kemarin?"), memanfaatkan tool calling EPIC-017.
 */

export type AskDoWidgetKey = "pulsa" | "tim" | "keputusan" | "stok" | "member";

function rupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

function pct(today: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.round(((today - base) / base) * 100);
}

export function buildAskDoPrompt(key: AskDoWidgetKey, overview: DesktopOverview | null): string {
  switch (key) {
    case "pulsa": {
      const p = overview?.pulsaBisnis;
      if (!p) return "Bagaimana penjualan hari ini dibanding kemarin? Apa yang menonjol?";
      const vsKemarin = pct(p.hariIni.omzet, p.kemarin.omzet);
      const vsMingguLalu = pct(p.hariIni.omzet, p.mingguLalu.omzet);
      const banding =
        vsMingguLalu !== null
          ? ` dan ${vsMingguLalu >= 0 ? "naik" : "turun"} ${Math.abs(vsMingguLalu)}% vs hari yang sama minggu lalu`
          : "";
      if (vsKemarin === null) {
        return `Omzet hari ini ${rupiah(p.hariIni.omzet)} dari ${p.hariIni.pesanan} pesanan${banding}. Bagaimana membacanya, dan apa yang perlu diperhatikan?`;
      }
      if (vsKemarin < 0) {
        return `Omzet hari ini ${rupiah(p.hariIni.omzet)}, turun ${Math.abs(vsKemarin)}% dibanding kemarin${banding}. Kenapa bisa turun dan apa yang sebaiknya dicek?`;
      }
      return `Omzet hari ini ${rupiah(p.hariIni.omzet)}, naik ${vsKemarin}% dibanding kemarin${banding}. Apa pendorong utamanya?`;
    }
    case "tim": {
      const t = overview?.timHariIni;
      if (!t) return "Siapa saja yang belum absen hari ini?";
      if (t.belum > 0) {
        return `Ada ${t.belum} karyawan yang belum absen hari ini (hadir ${t.hadir} dari ${t.aktif}). Siapa saja yang belum absen?`;
      }
      if (t.terlambat > 0) {
        return `Semua sudah absen tapi ${t.terlambat} orang terlambat hari ini. Siapa saja dan bagaimana polanya minggu ini?`;
      }
      return "Bagaimana kehadiran tim hari ini? Ada yang perlu perhatian?";
    }
    case "keputusan": {
      const k = overview?.perluKeputusan;
      if (!k || k.total === 0) return "Adakah pengajuan atau dokumen yang menunggu keputusan saya?";
      const rincian = [
        k.cuti > 0 ? `${k.cuti} cuti` : null,
        k.lembur > 0 ? `${k.lembur} lembur` : null,
        k.pinjaman > 0 ? `${k.pinjaman} pinjaman` : null,
        k.poDraft > 0 ? `${k.poDraft} PO draft` : null,
        k.kandidatBaru > 0 ? `${k.kandidatBaru} kandidat baru` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `Ada ${k.total} item menunggu keputusan (${rincian}). Mana yang paling mendesak untuk saya proses dulu?`;
    }
    case "stok": {
      const s = overview?.stokMenipis;
      if (!s || s.jumlah === 0) return "Bagaimana kondisi stok bahan baku saat ini?";
      const teratas = s.teratas.map((i) => i.bahan).join(", ");
      return `Ada ${s.jumlah} bahan di bawah batas minimum${teratas ? ` — paling kritis: ${teratas}` : ""}. Mana yang harus segera dipesan, dan apakah sudah ada yang sedang dipesan?`;
    }
    case "member": {
      const m = overview?.member;
      if (!m) return "Bagaimana perkembangan member dan loyalty 7 hari terakhir?";
      return `Tujuh hari terakhir: ${m.memberBaru7Hari} member baru, ${m.xpTerdistribusi7Hari.toLocaleString("id-ID")} XP keluar, ${m.rewardDitukar7Hari} reward ditukar. Bagaimana tren loyalty ini dan apa yang bisa ditingkatkan?`;
    }
  }
}
