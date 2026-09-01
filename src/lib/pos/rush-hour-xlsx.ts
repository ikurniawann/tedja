import * as XLSX from "xlsx";
import {
  RUSH_HOUR_HEATMAP_HOURS,
  RUSH_HOUR_WEEKDAYS,
  buildHourRangeContribution,
  formatHourLabel,
  type buildRushHourReport,
} from "@/lib/pos/rush-hour";

/**
 * Export Excel report Rush Hour (permintaan owner 2026-09-01) — format
 * rapi 4 sheet:
 *   1. Ringkasan   — periode, total, jam/hari puncak, kontribusi rentang
 *                    jam terpilih (Amount & Quantity sekaligus)
 *   2. Per Jam     — 24 baris + total, lengkap % kontribusi omzet & item
 *   3. Per Hari    — rekap Senin–Minggu
 *   4. Heatmap     — matriks hari × jam (08:00–22:00) jumlah transaksi
 */

export interface RushHourXlsxMeta {
  companyName: string;
  periodLabel: string;
  stallLabel: string;
  rangeFrom: number;
  rangeTo: number;
  generatedAt: Date;
}

type RushHourReportData = ReturnType<typeof buildRushHourReport>;

const rupiah = (value: number) => Math.round(value);

export function buildRushHourXlsx(
  report: RushHourReportData,
  meta: RushHourXlsxMeta
): Buffer {
  const wb = XLSX.utils.book_new();
  const printed = `Dicetak: ${meta.generatedAt.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  })} WIB`;
  const range = buildHourRangeContribution(
    report.hourly,
    report.summary,
    meta.rangeFrom,
    meta.rangeTo
  );
  const rangeLabel = `${formatHourLabel(range.from_hour)}–${formatHourLabel(range.to_hour)}`;

  /* ---------------- Sheet 1: Ringkasan ---------------- */
  const ringkasan: unknown[][] = [
    [`${meta.companyName} — Report Rush Hour`],
    [`Periode: ${meta.periodLabel}`],
    [`Stall: ${meta.stallLabel}`],
    [printed],
    [],
    ["TOTAL KESELURUHAN"],
    ["Jumlah transaksi", report.summary.transactions],
    ["Omzet (Rp)", rupiah(report.summary.revenue)],
    ["Item terjual", report.summary.quantity],
    ["Rata-rata bill (Rp)", rupiah(report.summary.average_ticket)],
    [],
    ["PUNCAK"],
    [
      "Jam tersibuk",
      report.peak_hour.hour_label ?? "—",
      `${report.peak_hour.transactions} transaksi`,
    ],
    [
      "Jam omzet tertinggi",
      report.peak_revenue_hour.hour_label ?? "—",
      `Rp ${rupiah(report.peak_revenue_hour.revenue).toLocaleString("id-ID")}`,
    ],
    [
      "Hari tersibuk",
      report.peak_day.dow_label ?? "—",
      `${report.peak_day.transactions} transaksi`,
    ],
    [],
    [`KONTRIBUSI RENTANG JAM ${rangeLabel}`],
    ["Berdasarkan", "Nilai dalam rentang", "Total keseluruhan", "Kontribusi (%)"],
    [
      "Amount / omzet (Rp)",
      rupiah(range.revenue),
      rupiah(report.summary.revenue),
      range.share_revenue,
    ],
    ["Quantity / item terjual", range.quantity, report.summary.quantity, range.share_quantity],
    ["Jumlah transaksi", range.transactions, report.summary.transactions, range.share_transactions],
  ];
  const wsRingkasan = XLSX.utils.aoa_to_sheet(ringkasan);
  wsRingkasan["!cols"] = [{ wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 16 }];
  wsRingkasan["!merges"] = [0, 1, 2, 3, 5, 11, 17].map((r) => ({
    s: { r, c: 0 },
    e: { r, c: 3 },
  }));
  XLSX.utils.book_append_sheet(wb, wsRingkasan, "Ringkasan");

  /* ---------------- Sheet 2: Per Jam ---------------- */
  const headerJam = [
    "Jam", "Transaksi", "Omzet (Rp)", "Item Terjual",
    "Rata-rata Bill (Rp)", "% Omzet", "% Item",
  ];
  const pct = (part: number, total: number) =>
    total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
  const perJam: unknown[][] = [
    [`${meta.companyName} — Rush Hour per Jam`],
    [`Periode: ${meta.periodLabel} · Stall: ${meta.stallLabel}`],
    [],
    headerJam,
    ...report.hourly.map((row) => [
      row.label,
      row.transactions,
      rupiah(row.revenue),
      row.quantity,
      rupiah(row.average_ticket),
      pct(row.revenue, report.summary.revenue),
      pct(row.quantity, report.summary.quantity),
    ]),
    [
      "TOTAL",
      report.summary.transactions,
      rupiah(report.summary.revenue),
      report.summary.quantity,
      rupiah(report.summary.average_ticket),
      report.summary.revenue > 0 ? 100 : 0,
      report.summary.quantity > 0 ? 100 : 0,
    ],
  ];
  const wsJam = XLSX.utils.aoa_to_sheet(perJam);
  wsJam["!cols"] = [
    { wch: 8 }, { wch: 11 }, { wch: 16 }, { wch: 13 },
    { wch: 18 }, { wch: 9 }, { wch: 9 },
  ];
  wsJam["!merges"] = [0, 1].map((r) => ({
    s: { r, c: 0 },
    e: { r, c: headerJam.length - 1 },
  }));
  XLSX.utils.book_append_sheet(wb, wsJam, "Per Jam");

  /* ---------------- Sheet 3: Per Hari ---------------- */
  const perHari: unknown[][] = [
    [`${meta.companyName} — Rush Hour per Hari`],
    [`Periode: ${meta.periodLabel} · Stall: ${meta.stallLabel}`],
    [],
    ["Hari", "Transaksi", "Omzet (Rp)"],
    ...report.weekdays.map((day) => [day.label, day.transactions, rupiah(day.revenue)]),
  ];
  const wsHari = XLSX.utils.aoa_to_sheet(perHari);
  wsHari["!cols"] = [{ wch: 10 }, { wch: 11 }, { wch: 16 }];
  wsHari["!merges"] = [0, 1].map((r) => ({ s: { r, c: 0 }, e: { r, c: 2 } }));
  XLSX.utils.book_append_sheet(wb, wsHari, "Per Hari");

  /* ---------------- Sheet 4: Heatmap ---------------- */
  const heatHeader = ["Hari \\ Jam", ...RUSH_HOUR_HEATMAP_HOURS.map((h) => formatHourLabel(h))];
  const heatRows = RUSH_HOUR_WEEKDAYS.map((day) => [
    day.label,
    ...RUSH_HOUR_HEATMAP_HOURS.map((hour) => {
      const cell = report.heatmap.find((c) => c.dow === day.dow && c.hour === hour);
      return cell?.transactions ?? 0;
    }),
  ]);
  const heatmap: unknown[][] = [
    [`${meta.companyName} — Heatmap Transaksi (hari × jam)`],
    [`Periode: ${meta.periodLabel} · Stall: ${meta.stallLabel}`],
    [],
    heatHeader,
    ...heatRows,
  ];
  const wsHeat = XLSX.utils.aoa_to_sheet(heatmap);
  wsHeat["!cols"] = [{ wch: 11 }, ...RUSH_HOUR_HEATMAP_HOURS.map(() => ({ wch: 7 }))];
  wsHeat["!merges"] = [0, 1].map((r) => ({
    s: { r, c: 0 },
    e: { r, c: heatHeader.length - 1 },
  }));
  XLSX.utils.book_append_sheet(wb, wsHeat, "Heatmap");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
