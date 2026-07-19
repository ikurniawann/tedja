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
import { useTransactionReport } from "../queries";
import type { TransactionReportRow } from "../types";

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

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

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

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric title="Transaksi" value={String(data?.summary.transactions ?? 0)} icon={ReceiptText} />
          <Metric title="Total penjualan" value={formatCurrency(data?.summary.total_sales ?? 0)} icon={Wallet} />
          <Metric
            title="ARK digunakan"
            value={formatCurrency(data?.summary.total_ark_used ?? 0)}
            icon={Store}
          />
        </div>

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
                        {row.stall_name || row.stall_code || "—"}
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
                  ? `${formatDateTime(selectedRow.ordered_at)} · ${selectedRow.stall_name || selectedRow.stall_code || "Stall"}`
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
