"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clock,
  Loader2,
  ReceiptText,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageTransition } from "@/components/motion";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { cn } from "@/lib/utils";
import {
  RUSH_HOUR_HEATMAP_HOURS,
  RUSH_HOUR_WEEKDAYS,
  formatHourLabel,
  rushHourHeatIntensity,
} from "@/lib/pos/rush-hour";
import { ApexChart } from "./apex-chart";
import { useRushHourReport } from "../queries";

const today = () => new Date().toISOString().slice(0, 10);
const firstDayOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);

function heatClass(intensity: number) {
  if (intensity <= 0) return "bg-muted/40 text-muted-foreground";
  if (intensity >= 0.75) return "bg-primary text-primary-foreground";
  if (intensity >= 0.5) return "bg-primary/70 text-primary-foreground";
  if (intensity >= 0.25) return "bg-primary/40 text-foreground";
  return "bg-primary/15 text-foreground";
}

export function RushHourReportPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [warehouseId, setWarehouseId] = useState("");
  const [applied, setApplied] = useState({
    date_from: firstDayOfMonth(),
    date_to: today(),
    warehouse_id: undefined as string | undefined,
  });

  const { data, isLoading, isFetching, error } = useRushHourReport(applied);

  useEffect(() => {
    if (!data) return;
    if (data.stall_locked && data.filters.warehouse_id && !warehouseId) {
      setWarehouseId(data.filters.warehouse_id);
    }
  }, [data, warehouseId]);

  const stallOptions = data?.stall_options ?? [];
  const stallLocked = Boolean(data?.stall_locked);
  const maxHeat = useMemo(
    () => Math.max(0, ...(data?.heatmap ?? []).map((cell) => cell.transactions)),
    [data?.heatmap]
  );

  const chartOptions = useMemo(
    () => ({
      chart: { toolbar: { show: false }, fontFamily: "inherit" },
      stroke: { width: [0, 3], curve: "smooth" as const },
      dataLabels: { enabled: false },
      colors: ["#6b7280", "#9ca3af"],
      xaxis: {
        categories: (data?.hourly ?? []).map((row) => row.label),
        labels: { rotate: -45, style: { fontSize: "11px" } },
      },
      yaxis: [
        { title: { text: "Transaksi" }, labels: { formatter: (v: number) => String(Math.round(v)) } },
        {
          opposite: true,
          title: { text: "Omzet" },
          labels: { formatter: (v: number) => formatCurrency(v) },
        },
      ],
      legend: { position: "top" as const },
      grid: { borderColor: "rgba(0,0,0,0.06)" },
      tooltip: {
        shared: true,
        y: {
          formatter: (value: number, opts: { seriesIndex: number }) =>
            opts.seriesIndex === 1 ? formatCurrency(value) : String(value),
        },
      },
    }),
    [data?.hourly]
  );

  function applyFilter() {
    setApplied({
      date_from: dateFrom,
      date_to: dateTo,
      warehouse_id: warehouseId || undefined,
    });
  }

  return (
    <PageTransition>
      <div className="space-y-5">
        <PurchasingPageHeader
          title="Rush Hour"
          description="Jam dan hari tersibuk dari transaksi lunas. Void tidak dihitung. Jam memakai WIB."
        />

        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="grid gap-4 p-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="rh-date-from">Tanggal dari</Label>
              <Input
                id="rh-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rh-date-to">Tanggal sampai</Label>
              <Input
                id="rh-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rh-stall">Stall</Label>
              <select
                id="rh-stall"
                value={warehouseId}
                disabled={stallLocked && stallOptions.length <= 1}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
              >
                {!stallLocked ? <option value="">Semua stall</option> : null}
                {stallOptions.map((stall) => (
                  <option key={stall.id} value={stall.id}>
                    {stall.name} ({stall.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={applyFilter} disabled={isFetching} className="w-full gap-2">
                {(isLoading || isFetching) && <Loader2 className="size-4 animate-spin" />}
                Terapkan filter
              </Button>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="size-4" />
            {error instanceof Error ? error.message : "Gagal memuat laporan"}
          </div>
        ) : null}

        <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
          <Metric
            title="Jam tersibuk"
            value={data?.peak_hour.hour_label ?? "—"}
            helper={
              data?.peak_hour.hour_label
                ? `${data.peak_hour.transactions} transaksi`
                : "Belum ada data"
            }
            icon={Clock}
          />
          <Metric
            title="Omzet jam tertinggi"
            value={data?.peak_revenue_hour.hour_label ?? "—"}
            helper={formatCurrency(data?.peak_revenue_hour.revenue ?? 0)}
            icon={TrendingUp}
          />
          <Metric
            title="Hari tersibuk"
            value={data?.peak_day.dow_label ?? "—"}
            helper={
              data?.peak_day.dow_label
                ? `${data.peak_day.transactions} transaksi`
                : "Belum ada data"
            }
            icon={ReceiptText}
          />
          <Metric
            title="Rata-rata bill"
            value={formatCurrency(data?.summary.average_ticket ?? 0)}
            helper={`${data?.summary.transactions ?? 0} transaksi`}
            icon={Wallet}
          />
        </div>

        <PurchasingListSection
          icon={Clock}
          title="Heatmap jam × hari"
          description="08:00–22:00. Warna lebih tua = lebih banyak transaksi."
        >
          <div className="overflow-x-auto px-4 pb-4">
            <div
              className="grid min-w-[720px] gap-1"
              style={{ gridTemplateColumns: `3rem repeat(${RUSH_HOUR_HEATMAP_HOURS.length}, minmax(0, 1fr))` }}
            >
              <div />
              {RUSH_HOUR_HEATMAP_HOURS.map((hour) => (
                <div
                  key={hour}
                  className="pb-1 text-center text-[10px] font-medium text-muted-foreground"
                >
                  {formatHourLabel(hour)}
                </div>
              ))}
              {RUSH_HOUR_WEEKDAYS.map((day) => (
                <div key={day.dow} className="contents">
                  <div className="flex items-center text-xs font-medium text-muted-foreground">
                    {day.label}
                  </div>
                  {RUSH_HOUR_HEATMAP_HOURS.map((hour) => {
                    const cell = data?.heatmap.find(
                      (item) => item.dow === day.dow && item.hour === hour
                    );
                    const count = cell?.transactions ?? 0;
                    return (
                      <div
                        key={`${day.dow}-${hour}`}
                        title={`${day.label} ${formatHourLabel(hour)} · ${count} trx · ${formatCurrency(cell?.revenue ?? 0)}`}
                        className={cn(
                          "grid h-9 place-items-center rounded-md text-[11px] font-medium",
                          heatClass(rushHourHeatIntensity(count, maxHeat))
                        )}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </PurchasingListSection>

        <PurchasingListSection
          icon={TrendingUp}
          title="Tren per jam"
          description="Jumlah transaksi dan omzet sepanjang hari, digabung untuk rentang tanggal."
        >
          <div className="px-4 pb-4">
            {isLoading && !data ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Memuat…
              </div>
            ) : (
              <ApexChart
                type="line"
                height={320}
                series={[
                  {
                    name: "Transaksi",
                    type: "column",
                    data: (data?.hourly ?? []).map((row) => row.transactions),
                  },
                  {
                    name: "Omzet",
                    type: "line",
                    data: (data?.hourly ?? []).map((row) => row.revenue),
                  },
                ]}
                options={chartOptions}
              />
            )}
          </div>
        </PurchasingListSection>

        <PurchasingListSection
          icon={ReceiptText}
          title="Rekap per jam"
          description="Rata-rata bill = omzet ÷ jumlah transaksi."
        >
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200/70 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5">Jam</th>
                  <th className="px-3 py-2.5 text-right">Transaksi</th>
                  <th className="px-3 py-2.5 text-right">Omzet</th>
                  <th className="px-3 py-2.5 text-right">Rata-rata bill</th>
                  <th className="px-3 py-2.5 text-right">% transaksi</th>
                </tr>
              </thead>
              <tbody>
                {(data?.hourly ?? []).map((row) => {
                  const share =
                    (data?.summary.transactions ?? 0) > 0
                      ? Math.round((row.transactions / data!.summary.transactions) * 1000) / 10
                      : 0;
                  const isPeak = data?.peak_hour.hour === row.hour && row.transactions > 0;
                  return (
                    <tr
                      key={row.hour}
                      className={cn(
                        "border-b border-gray-200/70 last:border-0",
                        isPeak ? "bg-primary/5" : "hover:bg-muted/30"
                      )}
                    >
                      <td className="px-3 py-2.5 font-medium">
                        {row.label}
                        {isPeak ? (
                          <span className="ml-2 text-xs font-medium text-primary">Puncak</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{row.transactions}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatCurrency(row.average_ticket)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {share}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PurchasingListSection>
      </div>
    </PageTransition>
  );
}

function Metric({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: string;
  helper: string;
  icon: typeof Clock;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="p-4">
        <div className="mb-2 w-fit rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-xl font-bold text-foreground">{value}</div>
        <div className="mt-1 text-sm text-muted-foreground">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{helper}</div>
      </CardContent>
    </Card>
  );
}
