import { describe, expect, it } from "vitest";
import type { DesktopOverview } from "@/lib/desktop/overview";
import {
  buildDigestMessage,
  buildStokHabisMessage,
  buildVoidBesarMessage,
  digestDedupKey,
  hourWib,
  stokHabisDedupKey,
  todayWib,
  voidDedupKey,
} from "./notifications-messages";

const overviewKosong: DesktopOverview = {
  dibuatPada: "2026-07-22T15:00:00.000Z",
  pulsaBisnis: null,
  timHariIni: null,
  perluKeputusan: null,
  stokMenipis: null,
  member: null,
  gagal: ["pulsaBisnis"],
};

describe("waktu WIB", () => {
  it("todayWib menggeser +7 jam — jam 20:00 UTC = besok WIB", () => {
    expect(todayWib(new Date("2026-07-22T20:00:00Z"))).toBe("2026-07-23");
    expect(todayWib(new Date("2026-07-22T10:00:00Z"))).toBe("2026-07-22");
  });

  it("hourWib mengembalikan jam lokal Jakarta", () => {
    expect(hourWib(new Date("2026-07-22T15:00:00Z"))).toBe(22);
    expect(hourWib(new Date("2026-07-22T18:30:00Z"))).toBe(1);
  });
});

describe("kunci dedup", () => {
  it("unik per kejadian", () => {
    expect(digestDedupKey("2026-07-22")).toBe("2026-07-22");
    expect(voidDedupKey("abc")).toBe("abc");
    expect(stokHabisDedupKey("m1", "2026-07-22")).toBe("m1:2026-07-22");
    expect(stokHabisDedupKey("m1", "2026-07-23")).not.toBe(
      stokHabisDedupKey("m1", "2026-07-22")
    );
  });
});

describe("buildVoidBesarMessage", () => {
  it("memuat nomor order, nominal terformat, alasan & penyetuju", () => {
    const msg = buildVoidBesarMessage({
      orderNumber: "ORD-0042",
      total: 750_000,
      reason: "salah input menu",
      supervisorName: "Budi",
    });
    expect(msg).toContain("ORD-0042");
    expect(msg).toContain("Rp750.000");
    expect(msg).toContain("salah input menu");
    expect(msg).toContain("Budi");
  });

  it("alasan panjang dipotong — pesan WA tidak meledak", () => {
    const msg = buildVoidBesarMessage({
      orderNumber: "X",
      total: 1,
      reason: "a".repeat(500),
      supervisorName: "S",
    });
    expect(msg.length).toBeLessThan(500);
  });
});

describe("buildStokHabisMessage", () => {
  it("mendaftar semua bahan dengan satuannya", () => {
    const msg = buildStokHabisMessage([
      { nama: "Ayam Fillet", satuan: "kg" },
      { nama: "Gula", satuan: null },
    ]);
    expect(msg).toContain("2 bahan");
    expect(msg).toContain("• Ayam Fillet (kg)");
    expect(msg).toContain("• Gula");
    expect(msg).not.toContain("(null)");
  });
});

describe("buildDigestMessage", () => {
  it("semua seksi gagal → pesan tetap terbentuk tanpa angka nol palsu", () => {
    const msg = buildDigestMessage(overviewKosong, "2026-07-22");
    expect(msg).toContain("Ringkasan Harian");
    expect(msg).toContain("Belum ada data hari ini.");
    expect(msg).not.toContain("Omzet:");
  });

  it("omzet naik/turun vs kemarin ditampilkan sebagai persen", () => {
    const overview: DesktopOverview = {
      ...overviewKosong,
      pulsaBisnis: {
        hariIni: { omzet: 1_200_000, pesanan: 10, rataRata: 120_000 },
        kemarin: { omzet: 1_000_000, pesanan: 8 },
        tujuhHari: [],
      },
    };
    const msg = buildDigestMessage(overview, "2026-07-22");
    expect(msg).toContain("Rp1.200.000");
    expect(msg).toContain("▲ 20% vs kemarin");
  });

  it("kemarin nol → tanpa pembanding (hindari bagi nol)", () => {
    const overview: DesktopOverview = {
      ...overviewKosong,
      pulsaBisnis: {
        hariIni: { omzet: 500_000, pesanan: 3, rataRata: 166_667 },
        kemarin: { omzet: 0, pesanan: 0 },
        tujuhHari: [],
      },
    };
    const msg = buildDigestMessage(overview, "2026-07-22");
    expect(msg).toContain("Rp500.000");
    expect(msg).not.toContain("vs kemarin");
  });

  it("antrean keputusan & stok menipis hanya tampil bila ada", () => {
    const overview: DesktopOverview = {
      ...overviewKosong,
      perluKeputusan: {
        cuti: 2,
        lembur: 0,
        pinjaman: 1,
        poDraft: 0,
        kandidatBaru: 0,
        total: 3,
      },
      stokMenipis: {
        jumlah: 2,
        teratas: [
          { bahan: "Ayam", tersedia: 1, minimum: 5 },
          { bahan: "Gula", tersedia: 0.5, minimum: 2 },
        ],
      },
    };
    const msg = buildDigestMessage(overview, "2026-07-22");
    expect(msg).toContain("Menunggu keputusan:* 3 (2 cuti, 1 pinjaman)");
    expect(msg).toContain("Stok menipis:* 2 bahan (Ayam, Gula)");

    const tanpaAntrean = buildDigestMessage(
      { ...overviewKosong, perluKeputusan: { cuti: 0, lembur: 0, pinjaman: 0, poDraft: 0, kandidatBaru: 0, total: 0 } },
      "2026-07-22"
    );
    expect(tanpaAntrean).not.toContain("Menunggu keputusan");
  });
});
