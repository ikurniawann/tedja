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
import { Badge } from "@/components/ui/badge";
import { useTransactionReport } from "../queries";
import type { TransactionReportRow } from "../types";
import { TransactionDetailBody } from "./transaction-detail-body";
import {
  formatPaymentMethodLabel,
  formatPaymentStatusLabel,
  isPaidPaymentStatus,
} from "../utils/transaction-labels";

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
  queue_number?: string | null;
  order_type?: string | null;
  table_id?: string | null;
  notes?: string | null;
  subtotal?: number | string | null;
  discount_amount?: number | string | null;
  tax_amount?: number | string | null;
  service_charge_amount?: number | string | null;
  total_amount?: number | string | null;
  amount_paid?: number | string | null;
  change_amount?: number | string | null;
  ark_coins_used?: number | string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  status?: string | null;
  sold_from?: string | null;
  checkout_id?: string | null;
  checkout_number?: string | null;
  xendit_external_id?: string | null;
  xendit_qr_id?: string | null;
  customer?: { name?: string | null } | null;
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
        throw new Error(payload.error || "Gagal memuat detail transaksi");
      }
      const detail = payload.data as OrderDetail;
      const checkoutId = detail.checkout_id || row.checkout_id;
      if (checkoutId) {
        const checkoutRes = await fetch(`/api/pos/checkouts/${checkoutId}`, {
          cache: "no-store",
        });
        const checkoutPayload = await checkoutRes.json().catch(() => ({}));
        const checkout = checkoutPayload?.data as
          | {
              checkout_number?: string | null;
              xendit_external_id?: string | null;
              xendit_qr_id?: string | null;
              payment_status?: string | null;
            }
          | undefined;
        if (checkoutRes.ok && checkout) {
          detail.checkout_number = checkout.checkout_number ?? row.checkout_number;
          detail.xendit_external_id =
            checkout.xendit_external_id ?? row.xendit_external_id ?? null;
          detail.xendit_qr_id = checkout.xendit_qr_id ?? row.xendit_qr_id ?? null;
        } else {
          detail.checkout_number = row.checkout_number;
          detail.xendit_external_id = row.xendit_external_id ?? null;
          detail.xendit_qr_id = row.xendit_qr_id ?? null;
        }
      } else {
        detail.checkout_number = row.checkout_number;
        detail.xendit_external_id = row.xendit_external_id ?? null;
        detail.xendit_qr_id = row.xendit_qr_id ?? null;
      }
      setOrderDetail(detail);
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
          description="Omzet yang sudah tercatat. Kolom Pembayaran = lunas/belum, bukan antrian dapur."
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
                  <th className="px-3 py-3 text-left font-semibold">Pembayaran</th>
                  <th className="px-3 py-3 text-left font-semibold">Metode</th>
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
                        <div>{row.order_number || row.id.slice(0, 8)}</div>
                        {row.checkout_number ? (
                          <div className="text-xs font-normal text-muted-foreground">
                            {row.checkout_number}
                            {row.sold_from === "central" ? " · Pusat" : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDateTime(row.ordered_at)}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatStallLabel(row)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          variant="outline"
                          className={
                            isPaidPaymentStatus(row.payment_status, row.status)
                              ? "border-emerald-200/80 bg-emerald-50 text-emerald-800"
                              : "border-amber-200/80 bg-amber-50 text-amber-800"
                          }
                        >
                          {formatPaymentStatusLabel(row.payment_status, row.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatPaymentMethodLabel(row.payment_method)}
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
          <DialogPanel size="xl">
            <DialogPanelHeader>
              <DialogPanelTitle>
                Detail transaksi{" "}
                {selectedRow?.order_number || selectedRow?.id.slice(0, 8) || ""}
              </DialogPanelTitle>
              <DialogPanelDescription>
                {selectedRow
                  ? `${formatDateTime(selectedRow.ordered_at)} · ${formatStallLabel(selectedRow)}`
                  : "Ringkasan pembayaran, item, dan status Xendit"}
              </DialogPanelDescription>
            </DialogPanelHeader>
            <DialogPanelBody className="space-y-4">
              {detailLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : (
                <TransactionDetailBody
                  row={selectedRow}
                  detail={orderDetail}
                  items={detailItems}
                />
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
