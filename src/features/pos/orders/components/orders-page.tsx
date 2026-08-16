"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle,
  ChefHat,
  Clock,
  CreditCard,
  ExternalLink,
  Eye,
  Loader2,
  Merge,
  Printer,
  Search,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  printThermalReceipt,
} from "@/components/pos/PrintReceipt";
import { Badge } from "@/components/ui/badge";
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
import { VoidModal } from "@/components/pos/VoidModal";
import { canVoidOrderStatus } from "@/lib/pos/void-order";
import { groupOrdersByCheckout } from "@/lib/pos/order-list-group";
import { formatPaymentMethodLabel } from "@/features/pos/reports/utils/transaction-labels";
import { cn } from "@/lib/utils";

import type { Order, OrderListParams } from "../types";
import { orderToReceiptPayload } from "../order-to-receipt";
import { useOrderList } from "../queries";
import { useLoyaltySettings } from "@/features/pos/loyalty-settings";
import { formatArkAmount } from "@/lib/pos/loyalty-settings";

const todayWib = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

const firstDayOfMonthWib = () => {
  const [year, month] = todayWib().split("-");
  return `${year}-${month}-01`;
};

const shiftWibDate = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const selectClassName =
  "flex h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary/30";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(Number(value)) ? Math.abs(Number(value)) : 0);

const formatDate = (dateString: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));

function StatusBadge({ status }: { status?: string | null }) {
  const value = String(status || "");
  const map: Record<
    string,
    { label: string; className: string; icon: typeof Clock }
  > = {
    pending: {
      label: "Pending",
      className: "bg-amber-50 text-amber-800",
      icon: Clock,
    },
    preparing: {
      label: "Preparing",
      className: "bg-sky-50 text-sky-800",
      icon: ChefHat,
    },
    ready: {
      label: "Ready",
      className: "bg-violet-50 text-violet-800",
      icon: CheckCircle,
    },
    completed: {
      label: "Completed",
      className: "bg-emerald-50 text-emerald-800",
      icon: CheckCircle,
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-red-50 text-red-700",
      icon: XCircle,
    },
    voided: {
      label: "Voided",
      className: "bg-muted text-muted-foreground",
      icon: XCircle,
    },
    merged: {
      label: "Merged",
      className: "bg-indigo-50 text-indigo-800",
      icon: Merge,
    },
  };
  const meta = map[value] || {
    label: value || "Unknown",
    className: "bg-muted text-muted-foreground",
    icon: Clock,
  };
  const Icon = meta.icon;
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 font-medium capitalize", meta.className)}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function TypeBadge({ type }: { type?: string | null }) {
  const value = String(type || "");
  const labels: Record<string, string> = {
    dine_in: "Dine-in",
    takeaway: "Takeaway",
    delivery: "Delivery",
    self_order: "Self-order",
  };
  return (
    <Badge
      variant="outline"
      className="border-gray-200/80 bg-white font-medium text-foreground"
    >
      {value === "delivery" ? <Truck className="mr-1 h-3 w-3" /> : null}
      {labels[value] || value || "—"}
    </Badge>
  );
}

function PaymentBadge({
  method,
  code,
  name,
}: {
  method?: string | null;
  code?: string | null;
  name?: string | null;
}) {
  const label = formatPaymentMethodLabel(method, { code, name });
  if (label === "—") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-gray-200/80 bg-white font-medium text-foreground"
    >
      <CreditCard className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function printOrderReceipt(order: Order) {
  void printThermalReceipt(orderToReceiptPayload(order), "CUSTOMER");
}

const STATUS_FILTERS = [
  "all",
  "pending",
  "preparing",
  "ready",
  "completed",
  "voided",
] as const;

const ORDER_LIST_LIMIT = 300;

type PeriodPreset = "today" | "7d" | "month";

function periodRange(preset: PeriodPreset) {
  const today = todayWib();
  if (preset === "today") return { date_from: today, date_to: today };
  if (preset === "7d") return { date_from: shiftWibDate(today, -6), date_to: today };
  return { date_from: firstDayOfMonthWib(), date_to: today };
}

export function OrdersPage() {
  const router = useRouter();
  const { data: loyaltySettings } = useLoyaltySettings();
  const formatArk = (value: number) =>
    formatArkAmount(value, loyaltySettings?.ark_rate || 1000);
  const initialPeriod = periodRange("today");
  const [dateFrom, setDateFrom] = useState(initialPeriod.date_from);
  const [dateTo, setDateTo] = useState(initialPeriod.date_to);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [orderType, setOrderType] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [applied, setApplied] = useState<OrderListParams>({
    date_from: initialPeriod.date_from,
    date_to: initialPeriod.date_to,
    limit: ORDER_LIST_LIMIT,
  });
  const { data: orders = [], isLoading, isFetching, isError, error, refetch } =
    useOrderList(applied);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedSiblings, setSelectedSiblings] = useState<Order[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(false);

  useEffect(() => {
    if (!isError) return;
    toast.error(error instanceof Error ? error.message : "Gagal memuat orders");
  }, [isError, error]);

  function applyFilter(next?: {
    date_from?: string;
    date_to?: string;
    payment_status?: string;
    order_type?: string;
    payment_method?: string;
  }) {
    const from = next?.date_from ?? dateFrom;
    const to = next?.date_to ?? dateTo;
    if (from && to && from > to) {
      toast.error("Tanggal dari tidak boleh melebihi tanggal sampai");
      return;
    }
    if (next?.date_from) setDateFrom(next.date_from);
    if (next?.date_to) setDateTo(next.date_to);
    setApplied({
      date_from: from,
      date_to: to,
      payment_status: (next?.payment_status ?? paymentStatus) || undefined,
      order_type: (next?.order_type ?? orderType) || undefined,
      payment_method: (next?.payment_method ?? paymentMethod) || undefined,
      limit: ORDER_LIST_LIMIT,
    });
  }

  const isPaid = (order: Order) =>
    (order.payment_status === "paid" || order.status === "completed") &&
    order.status !== "voided" &&
    order.status !== "cancelled";

  const statusCounts = useMemo(
    () => ({
      all: orders.length,
      pending: orders.filter((o) => o.status === "pending").length,
      preparing: orders.filter((o) => o.status === "preparing").length,
      ready: orders.filter((o) => o.status === "ready").length,
      completed: orders.filter((o) => isPaid(o)).length,
      voided: orders.filter((o) => o.status === "voided").length,
    }),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSearch =
        !q ||
        order.order_number?.toLowerCase().includes(q) ||
        order.checkout_number?.toLowerCase().includes(q) ||
        order.queue_number?.toLowerCase().includes(q) ||
        order.customer?.name?.toLowerCase().includes(q) ||
        order.cashier_id?.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "completed"
          ? isPaid(order)
          : order.status === statusFilter);
      return matchesSearch && matchesStatus;
    });
  }, [orders, searchTerm, statusFilter]);

  const groupedOrders = useMemo(
    () => groupOrdersByCheckout(filteredOrders),
    [filteredOrders]
  );

  const openDetail = (order: Order, siblings: Order[] = []) => {
    setSelectedOrder(order);
    setSelectedSiblings(siblings.length > 1 ? siblings : []);
    setShowDetailModal(true);
  };

  const canVoid = (order: Order) => canVoidOrderStatus(order.status);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Riwayat order per periode. Void order lunas lewat ikon Ban.
        </p>
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["today", "Hari ini"],
                ["7d", "7 hari"],
                ["month", "Bulan ini"],
              ] as const
            ).map(([key, label]) => {
              const range = periodRange(key);
              const active =
                dateFrom === range.date_from && dateTo === range.date_to;
              return (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "border-gray-200/80",
                    active && "border-primary/40 bg-primary/5 text-primary"
                  )}
                  disabled={isFetching}
                  onClick={() => applyFilter(range)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="orders-date-from">Tanggal dari</Label>
              <Input
                id="orders-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-10 border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-date-to">Tanggal sampai</Label>
              <Input
                id="orders-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-10 border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-payment-status">Pembayaran</Label>
              <select
                id="orders-payment-status"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                className={selectClassName}
              >
                <option value="">Semua</option>
                <option value="paid">Lunas</option>
                <option value="unpaid">Belum bayar</option>
                <option value="refunded">Refund</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-type">Tipe order</Label>
              <select
                id="orders-type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
                className={selectClassName}
              >
                <option value="">Semua</option>
                <option value="dine_in">Dine-in</option>
                <option value="takeaway">Takeaway</option>
                <option value="delivery">Delivery</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orders-method">Metode bayar</Label>
              <select
                id="orders-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className={selectClassName}
              >
                <option value="">Semua</option>
                <option value="cash">Tunai</option>
                <option value="qris">QRIS</option>
                <option value="credit">Kartu</option>
                <option value="ark_coin">ARK Coin</option>
                <option value="gift_card">Gift card</option>
                <option value="nfc_tab">NFC Tab</option>
              </select>
            </div>
            <div className="flex items-end xl:col-start-4">
              <Button
                type="button"
                onClick={() => applyFilter()}
                disabled={isFetching}
                className="w-full gap-2"
              >
                {isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
                Terapkan filter
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ["all", "Semua", statusCounts.all, "text-foreground"],
            ["pending", "Pending", statusCounts.pending, "text-amber-700"],
            ["preparing", "Preparing", statusCounts.preparing, "text-sky-700"],
            ["ready", "Ready", statusCounts.ready, "text-violet-700"],
            ["completed", "Lunas", statusCounts.completed, "text-emerald-700"],
            ["voided", "Void", statusCounts.voided, "text-muted-foreground"],
          ] as const
        ).map(([key, label, count, tone]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(key)}
            className={cn(
              "rounded-xl border bg-white p-3.5 text-left shadow-xs transition-colors",
              statusFilter === key
                ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
                : "border-gray-200/70 hover:border-primary/30 hover:bg-primary/5"
            )}
          >
            <div className="text-xs font-medium text-muted-foreground">{label}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>
              {count}
            </div>
          </button>
        ))}
      </div>

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari nomor order, checkout, antrian, atau pelanggan…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 border-gray-200/80 bg-white pl-10"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {groupedOrders.length} tagihan · {filteredOrders.length} order
              {applied.date_from && applied.date_to
                ? ` · ${applied.date_from} s/d ${applied.date_to}`
                : ""}
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading orders…
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200/80 bg-muted/20 px-4 py-16 text-center text-sm text-muted-foreground">
              Tidak ada order pada filter ini. Coba ubah periode atau kata kunci.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200/70">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200/70 bg-muted/30 text-left text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Order / Antrian</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Customer</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Items</th>
                    <th className="px-4 py-3 font-semibold">Payment</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="w-px whitespace-nowrap px-3 py-3 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupedOrders.map((row) => {
                    const order = row.kind === "single" ? row.order : row.orders[0];
                    if (!order) return null;
                    const isMixed = row.kind === "checkout";
                    const displayNumber = isMixed ? row.checkoutNumber : order.order_number;
                    const total = isMixed ? row.total : order.total_amount || 0;
                    const itemCount = isMixed
                      ? row.orders.reduce((sum, child) => sum + (child.items?.length || 0), 0)
                      : order.items?.length || 0;
                    const paid = isMixed ? row.paid : isPaid(order);
                    const orphanCheckout =
                      isMixed && row.orders.length === 1 && row.orders[0]?.id === row.checkoutId;
                    return (
                    <tr
                      key={isMixed ? row.checkoutId : order.id}
                      className="border-b border-gray-200/70 last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                        <div>{displayNumber}</div>
                        {isMixed && row.orders.length > 1 ? (
                          <div className="mt-0.5 space-y-0.5 font-sans text-[11px] font-medium text-primary">
                            <div>Gabungan {row.orders.length} stall</div>
                            <div className="font-mono font-normal text-muted-foreground">
                              {row.orders
                                .map((child) => child.order_number)
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                        ) : order.queue_number ? (
                          <div className="mt-0.5 text-[11px] font-bold text-primary">
                            Antrian {order.queue_number}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {order.ordered_at ? formatDate(order.ordered_at) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-medium text-foreground">
                            {order.customer?.name || "Walk-in"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <TypeBadge type={order.order_type} />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {itemCount}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentBadge
                          method={order.payment_method}
                          code={order.payment_method_code}
                          name={order.payment_method_name}
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {formatCurrency(total)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={order.status} />
                          {paid ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-50 font-medium text-emerald-800"
                            >
                              Lunas
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="bg-amber-50 font-medium text-amber-800"
                            >
                              Belum bayar
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td
                        className="w-px whitespace-nowrap px-3 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1">
                          {!paid && order.status !== "completed" ? (
                            <Button
                              type="button"
                              size="icon"
                              className="h-8 w-8 bg-primary hover:bg-primary/90"
                              title="Open in cashier"
                              onClick={() =>
                                router.push(
                                  orphanCheckout
                                    ? `/dashboard/pos/cashier-new?checkoutId=${order.id}`
                                    : `/dashboard/pos/cashier-new?orderId=${order.id}`
                                )
                              }
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 border-gray-200/80"
                            title="Detail"
                            onClick={() =>
                              openDetail(
                                order,
                                isMixed ? row.orders : []
                              )
                            }
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {canVoid(order) ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 border-red-200/80 text-red-700 hover:bg-red-50"
                              title="Void order"
                              onClick={() => {
                                setSelectedOrder(order);
                                setShowVoidModal(true);
                              }}
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showDetailModal}
        onOpenChange={(open) => {
          setShowDetailModal(open);
          if (!open) {
            setSelectedOrder(null);
            setSelectedSiblings([]);
          }
        }}
      >
        <DialogPanel size="xl">
          <DialogPanelHeader>
            <DialogPanelTitle>
              {selectedSiblings.length > 1
                ? selectedOrder?.checkout_number || "Tagihan gabungan"
                : "Order detail"}
            </DialogPanelTitle>
            <DialogPanelDescription>
              {selectedSiblings.length > 1
                ? selectedSiblings
                    .map((child) => child.order_number)
                    .filter(Boolean)
                    .join(" · ")
                : selectedOrder?.order_number || "Order"}
              {selectedOrder?.ordered_at
                ? ` · ${formatDate(selectedOrder.ordered_at)}`
                : ""}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            {selectedOrder ? (
              <OrderDetail order={selectedOrder} siblings={selectedSiblings} />
            ) : null}
          </DialogPanelBody>
          <DialogFooter>
            {selectedOrder && canVoid(selectedOrder) ? (
              <Button
                type="button"
                variant="outline"
                className="border-red-200/80 text-red-700 hover:bg-red-50"
                onClick={() => {
                  setShowDetailModal(false);
                  setShowVoidModal(true);
                }}
              >
                <Ban className="mr-2 h-4 w-4" />
                Void
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => {
                if (!selectedOrder) return;
                printOrderReceipt(selectedOrder);
              }}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print receipt
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => setShowDetailModal(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogPanel>
      </Dialog>

      <VoidModal
        open={showVoidModal}
        order={selectedOrder}
        onClose={() => {
          setShowVoidModal(false);
          setSelectedOrder(null);
          setSelectedSiblings([]);
        }}
        onSuccess={() => {
          void refetch();
          setSelectedOrder(null);
          setSelectedSiblings([]);
        }}
      />
    </div>
  );
}

function OrderDetail({
  order,
  siblings = [],
}: {
  order: Order;
  siblings?: Order[];
}) {
  const { data: loyaltySettings } = useLoyaltySettings();
  const formatArk = (value: number) =>
    formatArkAmount(value, loyaltySettings?.ark_rate || 1000);
  const childOrders = siblings.length > 1 ? siblings : [order];
  const billTotal = childOrders.reduce(
    (sum, child) => sum + (Number(child.total_amount) || 0),
    0
  );
  const billSubtotal = childOrders.reduce(
    (sum, child) => sum + (Number(child.subtotal) || 0),
    0
  );
  const billDiscount = childOrders.reduce(
    (sum, child) => sum + (Number(child.discount_amount) || 0),
    0
  );
  const billTax = childOrders.reduce(
    (sum, child) => sum + (Number(child.tax_amount) || 0),
    0
  );
  const billArk = childOrders.reduce(
    (sum, child) => sum + (Number(child.ark_coins_used) || 0),
    0
  );
  const billPaid = childOrders.reduce(
    (sum, child) => sum + (Number(child.amount_paid) || 0),
    0
  );
  const billChange = childOrders.reduce(
    (sum, child) => sum + (Number(child.change_amount) || 0),
    0
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoTile
          label={childOrders.length > 1 ? "Checkout" : "Order"}
          value={
            childOrders.length > 1
              ? order.checkout_number || order.order_number || "—"
              : order.order_number || "—"
          }
          mono
        />
        <InfoTile label="Antrian" value={order.queue_number || "—"} mono />
        <InfoTile
          label="Date"
          value={order.ordered_at ? formatDate(order.ordered_at) : "—"}
        />
        <div className="rounded-xl border border-gray-200/70 bg-muted/20 px-3.5 py-3">
          <div className="text-xs font-medium text-muted-foreground">Status</div>
          <div className="mt-1.5">
            <StatusBadge status={order.status} />
          </div>
        </div>
        <div className="rounded-xl border border-gray-200/70 bg-muted/20 px-3.5 py-3">
          <div className="text-xs font-medium text-muted-foreground">Payment</div>
          <div className="mt-1.5">
            <PaymentBadge
              method={order.payment_method}
              code={order.payment_method_code}
              name={order.payment_method_name}
            />
          </div>
        </div>
      </div>

      {order.customer ? (
        <section className="rounded-xl border border-gray-200/70 bg-white p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <User className="h-4 w-4 text-muted-foreground" />
            Customer
          </h3>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted-foreground">Name</span>
              <div className="font-medium text-foreground">
                {order.customer.name}
              </div>
            </div>
            {order.customer.phone ? (
              <div>
                <span className="text-muted-foreground">Phone</span>
                <div className="font-medium text-foreground">
                  {order.customer.phone}
                </div>
              </div>
            ) : null}
            {order.customer.membership_tier ? (
              <div>
                <span className="text-muted-foreground">Tier</span>
                <div className="font-medium capitalize text-foreground">
                  {order.customer.membership_tier}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {childOrders.length > 1 ? (
        <section className="rounded-xl border border-gray-200/70 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            Nomor POS per stall
          </h3>
          <div className="space-y-2">
            {childOrders.map((child) => (
              <div
                key={child.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/70 bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-foreground">
                    {child.order_number || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {child.items?.length || 0} item
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatCurrency(child.total_amount || 0)}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-gray-200/70 bg-white">
        <div className="border-b border-gray-200/70 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Items</h3>
        </div>
        <div className="divide-y divide-gray-200/70">
          {childOrders.map((child) => (
            <div key={child.id}>
              {childOrders.length > 1 ? (
                <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-2">
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {child.order_number || "—"}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatCurrency(child.total_amount || 0)}
                  </span>
                </div>
              ) : null}
              {(child.items || []).map((item, idx) => (
                <div
                  key={item.id || `${child.id}-${item.product_id}-${idx}`}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">
                      {item.product_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {item.quantity} × {formatCurrency(item.unit_price || 0)}
                    </div>
                    {item.variants && item.variants.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {item.variants.map((v, i) => (
                          <Badge
                            key={i}
                            variant="secondary"
                            className="bg-primary/10 text-xs text-primary"
                          >
                            {v.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {item.modifiers && item.modifiers.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.modifiers.map((m, i) => (
                          <Badge
                            key={i}
                            variant="secondary"
                            className="bg-amber-50 text-xs text-amber-800"
                          >
                            {m.name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 font-semibold tabular-nums text-foreground">
                    {formatCurrency(item.total_amount || 0)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200/70 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Payment summary
        </h3>
        <div className="space-y-2 text-sm">
          <SummaryRow label="Subtotal" value={formatCurrency(billSubtotal)} />
          {billDiscount > 0 ? (
            <SummaryRow
              label="Discount"
              value={`−${formatCurrency(billDiscount)}`}
              tone="text-emerald-600"
            />
          ) : null}
          {billTax > 0 ? (
            <SummaryRow label="Tax" value={formatCurrency(billTax)} />
          ) : null}
          {billArk > 0 ? (
            <SummaryRow
              label="ARK used"
              value={`−${formatArk(billArk)}`}
              tone="text-amber-700"
            />
          ) : null}
          <div className="flex items-center justify-between border-t border-gray-200/70 pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums text-primary">
              {formatCurrency(billTotal)}
            </span>
          </div>
          <SummaryRow label="Paid" value={formatCurrency(billPaid)} />
          {billChange > 0 ? (
            <SummaryRow
              label="Change"
              value={formatCurrency(billChange)}
            />
          ) : null}
        </div>
      </section>

      {order.notes ? (
        <section className="rounded-xl border border-gray-200/70 bg-muted/20 p-4">
          <div className="text-xs font-medium text-muted-foreground">Notes</div>
          <p className="mt-1 text-sm text-foreground">{order.notes}</p>
        </section>
      ) : null}
    </div>
  );
}

function InfoTile({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-muted/20 px-3.5 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 break-all text-sm font-semibold text-foreground",
          mono && "font-mono text-xs"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium tabular-nums text-foreground", tone)}>
        {value}
      </span>
    </div>
  );
}
