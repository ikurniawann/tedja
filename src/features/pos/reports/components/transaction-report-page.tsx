"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Eye,
  Loader2,
  ReceiptText,
  Store,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelDescription,
  DialogPanelHeader,
  DialogPanelTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageTransition } from "@/components/motion";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { ApexChart } from "./apex-chart";
import { useTransactionReport } from "../queries";
import type { TransactionReportRow } from "../types";

const today = () => new Date().toISOString().slice(0, 10);
const firstDayOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Jangan render UUID mentah di kolom Stall. */
function formatStallLabel(row: Pick<TransactionReportRow, "stall_name" | "stall_code">) {
  const name = row.stall_name?.trim();
  if (name && !UUID_RE.test(name)) return name;
  const code = row.stall_code?.trim();
  if (code && !UUID_RE.test(code)) return code;
  return "—";
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);

const formatQty = (value: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value || 0);

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

type OrderItemDetail = {
  id: string;
  product_name?: string | null;
  product_sku?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  total_amount?: number | string | null;
  station?: string | null;
};

type OrderDetail = {
  id: string;
  order_number?: string | null;
  ordered_at?: string | null;
  total_amount?: number | string | null;
  payment_method?: string | null;
  status?: string | null;
  items?: OrderItemDetail[];
};

export function TransactionReportPage() {
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [warehouseId, setWarehouseId] = useState("");
  const [applied, setApplied] = useState({
    date_from: firstDayOfMonth(),
    date_to: today(),
    warehouse_id: undefined as string | undefined,
  });
  const [selectedRow, setSelectedRow] = useState<TransactionReportRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);

  const { data, isLoading, isFetching, error } = useTransactionReport(applied);

  useEffect(() => {
    if (!data) return;
    if (data.stall_locked && data.filters.warehouse_id && !warehouseId) {
      setWarehouseId(data.filters.warehouse_id);
    }
  }, [data, warehouseId]);

  const stallOptions = data?.stall_options ?? [];
  const stallLocked = Boolean(data?.stall_locked);

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const detailItems = orderDetail?.items ?? [];

  function applyFilter() {
    setApplied({
      date_from: dateFrom,
      date_to: dateTo,
      warehouse_id: warehouseId || undefined,
    });
  }

  async function openItemDetail(row: TransactionReportRow) {
    setSelectedRow(row);
    setDetailOpen(true);
    setDetailLoading(true);
    setOrderDetail(null);
    try {
      const response = await fetch(`/api/pos/orders/${row.id}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error || "Gagal memuat detail item");
      }
      setOrderDetail(payload.data as OrderDetail);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal memuat detail item";
      toast.error(message);
      setDetailOpen(false);
      setSelectedRow(null);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <PageTransition>
      <div className="space-y-5">
        <PurchasingPageHeader
          title="Laporan Transaksi"
          description="Daftar transaksi POS berdasarkan rentang tanggal dan stall."
        />

        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="grid gap-4 p-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="tx-date-from">Tanggal dari</Label>
              <Input
                id="tx-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-date-to">Tanggal sampai</Label>
              <Input
                id="tx-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-stall">Stall</Label>
              <select
                id="tx-stall"
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

        {/* Rincian keuangan (permintaan owner): Revenue − Diskon + Pajak +
            Service = Nett — identitasnya bisa diperiksa pembaca sendiri. */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
          <Metric title="Transaksi" value={String(data?.summary.transactions ?? 0)} icon={ReceiptText} />
          <Metric title="Revenue (kotor)" value={formatCurrency(data?.summary.revenue ?? 0)} icon={Wallet} />
          <Metric title="Diskon" value={`− ${formatCurrency(data?.summary.discount ?? 0)}`} icon={Wallet} />
          <Metric title="Pajak" value={formatCurrency(data?.summary.tax ?? 0)} icon={Wallet} />
          <Metric title="Service" value={formatCurrency(data?.summary.service ?? 0)} icon={Wallet} />
          <Metric title="Nett" value={formatCurrency(data?.summary.nett ?? 0)} icon={Store} />
        </div>

        {/* Tren nett harian + top produk pada filter yang sama */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <div className="mb-3 text-sm font-semibold text-foreground">Tren Penjualan Harian (Nett)</div>
              {(data?.daily?.length ?? 0) === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada data pada filter ini
                </div>
              ) : (
                <ApexChart
                  type="area"
                  height={240}
                  series={[
                    {
                      name: "Nett",
                      data: (data?.daily ?? []).map((d) => ({ x: d.date, y: d.nett })),
                    },
                  ]}
                  options={{
                    chart: { toolbar: { show: false } },
                    dataLabels: { enabled: false },
                    stroke: { curve: "smooth", width: 2 },
                    xaxis: { type: "category" },
                    yaxis: {
                      labels: {
                        formatter: (v: number) => new Intl.NumberFormat("id-ID", { notation: "compact" }).format(v),
                      },
                    },
                    tooltip: { y: { formatter: (v: number) => formatCurrency(v) } },
                  }}
                />
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-200/70 shadow-xs">
            <CardContent className="p-4">
              <div className="mb-3 text-sm font-semibold text-foreground">Top Produk</div>
              {(data?.top_products?.length ?? 0) === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Belum ada data pada filter ini
                </div>
              ) : (
                <div className="space-y-2.5">
                  {(data?.top_products ?? []).map((prod, index) => {
                    const max = data?.top_products?.[0]?.revenue || 1;
                    return (
                      <div key={prod.product_name}>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-medium text-foreground">
                            {index + 1}. {prod.product_name}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {formatQty(prod.quantity)} pcs · {formatCurrency(prod.revenue)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(4, (prod.revenue / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Rekap per stall — jawaban langsung 'laporan transaksi per stall' */}
        <PurchasingListSection
          icon={Store}
          title="Rekap per Stall"
          description="Berbasis item: order lintas stall menyumbang ke tiap stall sesuai itemnya (nilai setelah diskon item, sebelum diskon/pajak transaksi)"
        >
          <div className="overflow-x-auto px-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Stall</th>
                  <th className="px-3 py-3 text-right font-semibold">Transaksi</th>
                  <th className="px-3 py-3 text-right font-semibold">Item Terjual</th>
                  <th className="px-3 py-3 text-right font-semibold">Penjualan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/70">
                {(data?.per_stall?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                      Belum ada data pada filter ini
                    </td>
                  </tr>
                ) : (
                  (data?.per_stall ?? []).map((stall) => (
                    <tr key={stall.stall_code ?? stall.stall_name} className="hover:bg-muted/30">
                      <td className="px-3 py-3 font-medium text-foreground">
                        {formatStallLabel(stall)}
                      </td>
                      <td className="px-3 py-3 text-right">{stall.transactions}</td>
                      <td className="px-3 py-3 text-right">{stall.quantity}</td>
                      <td className="px-3 py-3 text-right font-semibold">{formatCurrency(stall.sales)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </PurchasingListSection>

        <PurchasingListSection
          icon={CalendarDays}
          title="Detail transaksi"
          description={`${rows.length} baris untuk periode ${applied.date_from} s/d ${applied.date_to}`}
        >
          <div className="overflow-x-auto px-4">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Order</th>
                  <th className="px-3 py-3 text-left font-semibold">Waktu</th>
                  <th className="px-3 py-3 text-left font-semibold">Stall</th>
                  <th className="px-3 py-3 text-left font-semibold">Status</th>
                  <th className="px-3 py-3 text-left font-semibold">Payment</th>
                  <th className="px-3 py-3 text-right font-semibold">Total</th>
                  <th className="px-3 py-3 text-right font-semibold">ARK</th>
                  <th className="px-3 py-3 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/70">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto size-5 animate-spin" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                      Tidak ada transaksi pada filter ini
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-3 py-3 font-medium text-foreground">
                        {row.order_number || row.id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.ordered_at)}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatStallLabel(row)}
                      </td>
                      <td className="px-3 py-3 capitalize text-muted-foreground">
                        {row.status || "—"}
                      </td>
                      <td className="px-3 py-3 capitalize text-muted-foreground">
                        {row.payment_method || row.payment_status || "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-medium">
                        {formatCurrency(row.total_amount)}
                      </td>
                      <td className="px-3 py-3 text-right text-amber-700">
                        {formatCurrency(row.ark_coins_used)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-border"
                          onClick={() => void openItemDetail(row)}
                          disabled={detailLoading && selectedRow?.id === row.id}
                        >
                          {detailLoading && selectedRow?.id === row.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                          Detail
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </PurchasingListSection>

        <Dialog
          open={detailOpen}
          onOpenChange={(open) => {
            setDetailOpen(open);
            if (!open) {
              setSelectedRow(null);
              setOrderDetail(null);
            }
          }}
        >
          <DialogPanel size="lg">
            <DialogPanelHeader>
              <DialogPanelTitle>
                Detail item — {selectedRow?.order_number || selectedRow?.id.slice(0, 8) || "Order"}
              </DialogPanelTitle>
              <DialogPanelDescription>
                {selectedRow
                  ? `${formatDateTime(selectedRow.ordered_at)} · ${formatStallLabel(selectedRow)}`
                  : "Item dalam transaksi"}
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="grid gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm sm:grid-cols-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Status</div>
                      <div className="font-medium capitalize">
                        {orderDetail?.status || selectedRow?.status || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Payment</div>
                      <div className="font-medium capitalize">
                        {orderDetail?.payment_method || selectedRow?.payment_method || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Total</div>
                      <div className="font-medium">
                        {formatCurrency(toNumber(orderDetail?.total_amount ?? selectedRow?.total_amount))}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-gray-200/70 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2.5 text-left font-semibold">Produk</th>
                          <th className="px-3 py-2.5 text-left font-semibold">SKU</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200/70">
                        {detailItems.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                              Tidak ada item
                            </td>
                          </tr>
                        ) : (
                          detailItems.map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-2.5 font-medium text-foreground">
                                {item.product_name || "—"}
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground">
                                {item.product_sku || "—"}
                              </td>
                              <td className="px-3 py-2.5 text-right">{formatQty(toNumber(item.quantity))}</td>
                              <td className="px-3 py-2.5 text-right text-muted-foreground">
                                {formatCurrency(toNumber(item.unit_price))}
                              </td>
                              <td className="px-3 py-2.5 text-right font-medium">
                                {formatCurrency(toNumber(item.total_amount))}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </DialogPanelBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDetailOpen(false)}
                className="border-border"
              >
                Tutup
              </Button>
            </DialogFooter>
          </DialogPanel>
        </Dialog>
      </div>
    </PageTransition>
  );
}

function Metric({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string;
  icon: typeof ReceiptText;
}) {
  return (
    <Card className="border-gray-200/70 shadow-xs">
      <CardContent className="p-4">
        <div className="mb-2 rounded-lg bg-primary/10 p-2 text-primary w-fit">
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-xl font-bold text-foreground">{value}</div>
        <div className="mt-1 text-sm text-muted-foreground">{title}</div>
      </CardContent>
    </Card>
  );
}
