"use client";

// Fase E — Laporan Ticketing: traffic gate, revenue tiket (net void) per
// produk/kanal/musim/paket, F&B on-tab, uang masuk per metode
// (rekonsiliasi kasir harian), rekap gelang, dan tab menggantung.

import { useState } from "react";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableRow } from "@/components/ui/table";
import { useTicketingReport, type ReportAggRow } from "../queries";

const formatRp = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

const formatDateShort = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date()
  );

const addDaysIso = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  card: "Kartu / EDC",
  xendit: "Xendit (online)",
  lainnya: "Lainnya",
};

const BAND_STATUS_STYLES: Record<string, string> = {
  tersedia: "bg-emerald-100 text-emerald-700",
  dipakai: "bg-blue-100 text-blue-700",
  hilang: "bg-red-100 text-red-700",
  rusak: "bg-amber-100 text-amber-700",
};

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-gray-400">{hint}</p> : null}
    </div>
  );
}

function AggTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: ReportAggRow[];
  emptyText: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <table className="mt-2 w-full text-sm">
        <tbody className="divide-y divide-gray-200/50">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="py-1.5 pr-2 text-gray-700">{row.label}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-gray-500">
                {row.qty}×
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums text-gray-900">
                {formatRp(row.net)}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-4 text-center text-xs text-gray-400">
                {emptyText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function TicketingReportsPage() {
  const today = todayIso();
  const [from, setFrom] = useState(addDaysIso(today, -6));
  const [to, setTo] = useState(today);

  const reportQuery = useTicketingReport(from, to);
  const report = reportQuery.data;

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200/70 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
              <ChartBarIcon className="h-6 w-6 text-pink-600" />
              Laporan Ticketing
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Traffic gate, revenue tiket & F&B (net void), uang masuk per
              metode, rekap gelang, dan tab menggantung — hari operasional WIB.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="report_from" className="text-xs">
                Dari
              </Label>
              <Input
                id="report_from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report_to" className="text-xs">
                Sampai
              </Label>
              <Input
                id="report_to"
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 w-40"
              />
            </div>
          </div>
        </div>
      </div>

      {reportQuery.isLoading ? (
        <div className="py-20 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-pink-600" />
          <p className="mt-2 text-sm text-gray-500">Memuat laporan...</p>
        </div>
      ) : reportQuery.isError ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {(reportQuery.error as Error).message}
        </p>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Kunjungan Terdaftar"
              value={String(report.summary.visits_opened)}
              hint={`${report.summary.orang_masuk} orang masuk gate · ${report.summary.masuk_lagi} re-entry · ${report.summary.masuk_karyawan} karyawan · ${report.summary.tap_ditolak} tap ditolak`}
            />
            <StatCard
              label="Revenue Tiket (net)"
              value={formatRp(report.summary.tiket_net)}
              hint={
                report.summary.denda_net > 0
                  ? `+ denda ${formatRp(report.summary.denda_net)}`
                  : undefined
              }
            />
            <StatCard
              label="Revenue F&B on-Tab (net)"
              value={formatRp(report.summary.fnb_net)}
              hint="Penjualan F&B via gelang — di luar penjualan kasir langsung"
            />
            <StatCard
              label="Uang Masuk"
              value={formatRp(report.summary.uang_masuk)}
              hint={
                report.summary.refund_keluar > 0
                  ? `refund keluar ${formatRp(report.summary.refund_keluar)}`
                  : "deposit + pembayaran (semua metode)"
              }
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200/70 bg-white">
            <table className="w-full text-sm">
              <thead>
                <TableRow className="border-b border-gray-200/70 bg-gray-50/80 text-xs uppercase tracking-wide text-gray-500 hover:bg-gray-50/80">
                  <th className="px-4 py-2.5 text-left font-semibold">Tanggal</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Kunjungan</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Masuk</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Re-entry</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Tiket (net)</th>
                  <th className="px-4 py-2.5 text-right font-semibold">F&B (net)</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Uang Masuk</th>
                </TableRow>
              </thead>
              <tbody className="divide-y divide-gray-200/50">
                {report.daily.map((day) => (
                  <TableRow key={day.date} className="hover:bg-gray-50/80">
                    <td className="px-4 py-2">{formatDateShort(day.date)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {day.visits}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {day.masuk}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {day.masuk_lagi}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatRp(day.tiket_net)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatRp(day.fnb_net)}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {formatRp(day.uang_masuk)}
                    </td>
                  </TableRow>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <AggTable
              title="Revenue Tiket per Produk"
              rows={report.tickets.products}
              emptyText="Belum ada penjualan tiket pada rentang ini"
            />
            <AggTable
              title="Revenue Tiket per Kanal"
              rows={report.tickets.channels}
              emptyText="Belum ada penjualan tiket pada rentang ini"
            />
            <AggTable
              title="Revenue Tiket per Musim"
              rows={report.tickets.seasons}
              emptyText="Belum ada penjualan tiket pada rentang ini"
            />
            <AggTable
              title="Kontribusi Paket (alokasi per anggota)"
              rows={report.tickets.bundles}
              emptyText="Belum ada penjualan paket pada rentang ini"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200/70 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Uang Masuk per Metode (rekonsiliasi kasir)
              </h3>
              <table className="mt-2 w-full text-sm">
                <tbody className="divide-y divide-gray-200/50">
                  {report.methods.map((m) => (
                    <tr key={`${m.charge_type}-${m.method}`}>
                      <td className="py-1.5 pr-2 text-gray-700">
                        {METHOD_LABELS[m.method] ?? m.method}
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-gray-400">
                        {m.charge_type === "refund-deposit"
                          ? "refund keluar"
                          : m.charge_type}
                      </td>
                      <td
                        className={`py-1.5 text-right font-medium tabular-nums ${
                          m.charge_type === "refund-deposit"
                            ? "text-red-600"
                            : "text-gray-900"
                        }`}
                      >
                        {m.charge_type === "refund-deposit" ? "−" : ""}
                        {formatRp(m.total)}
                      </td>
                    </tr>
                  ))}
                  {report.methods.length === 0 ? (
                    <tr>
                      <td className="py-4 text-center text-xs text-gray-400">
                        Belum ada uang masuk pada rentang ini
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-gray-200/70 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900">
                Rekap Gelang (saat ini)
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {report.bands.map((b) => (
                  <Badge
                    key={b.status}
                    className={`border-0 font-normal ${
                      BAND_STATUS_STYLES[b.status] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {b.n} {b.status}
                  </Badge>
                ))}
                {report.bands.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    Belum ada gelang terdaftar
                  </p>
                ) : null}
              </div>

              <h3 className="mt-4 text-sm font-semibold text-gray-900">
                Tab Menggantung ({report.hanging.count} visit ·{" "}
                {formatRp(report.hanging.total)})
              </h3>
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {report.hanging.items.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-gray-200/70 px-3 py-1.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-800">
                        {h.contact_name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {h.payment_mode} ·{" "}
                        {new Date(h.opened_at).toLocaleString("id-ID", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums text-amber-700">
                      {formatRp(h.outstanding)}
                    </span>
                  </div>
                ))}
                {report.hanging.items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-400">
                    Tidak ada tab menggantung — semua visit terbuka bersaldo aman
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
