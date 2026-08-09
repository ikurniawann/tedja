"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CheckCircle,
  ChefHat,
  Clock,
  Coins,
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
import { VoidModal } from "@/components/pos/VoidModal";
import { cn } from "@/lib/utils";

import type { Order } from "../types";
import { useOrderList } from "../queries";
import { useLoyaltySettings } from "@/features/pos/loyalty-settings";
import { formatArkAmount } from "@/lib/pos/loyalty-settings";

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

function PaymentBadge({ method }: { method?: string | null }) {
  if (!method) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const value = String(method);
  if (value === "ark_coin") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-200/80 bg-amber-50 font-medium text-amber-800"
      >
        <Coins className="h-3 w-3" />
        ARK
      </Badge>
    );
  }
  const label =
    value === "cash"
      ? "Cash"
      : value === "qris"
        ? "QRIS"
        : value === "credit_card" || value === "credit"
          ? "Card"
          : value.replace("_", " ");
  return (
    <Badge
      variant="outline"
      className="gap-1 border-gray-200/80 bg-white font-medium capitalize text-foreground"
    >
      <CreditCard className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function printReceiptPreview(order: Order) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Could not open print window");
    return;
  }
  printWindow.document.write(`
    <html>
      <head>
        <title>Receipt - ${order.order_number}</title>
        <style>
          body { font-family: monospace; width: 58mm; padding: 10px; margin: 0; }
          .header { text-align: center; margin-bottom: 10px; }
          .divider { border-bottom: 1px dashed #000; margin: 5px 0; }
          .row { display: flex; justify-content: space-between; margin: 3px 0; }
          .total { font-weight: bold; font-size: 1.2em; }
          @media print { @page { margin: 0; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h3>Arkiv OS POS</h3>
          <p>${order.order_number}</p>
          ${order.queue_number ? `<p>Antrian ${order.queue_number}</p>` : ""}
          <p>${new Date(order.ordered_at || Date.now()).toLocaleString("en-GB")}</p>
        </div>
        <div class="divider"></div>
        ${(order.items || [])
          .map(
            (item: {
              product_name?: string;
              quantity?: number;
              total_amount?: number;
            }) => `
          <div class="row">
            <span>${item.product_name} x${item.quantity}</span>
            <span>${(Number(item.total_amount) || 0).toLocaleString("id-ID")}</span>
          </div>
        `
          )
          .join("")}
        <div class="divider"></div>
        <div class="row total">
          <span>Total</span>
          <span>${(Number(order.total_amount) || 0).toLocaleString("id-ID")}</span>
        </div>
        <div class="row">
          <span>Payment</span>
          <span>${(order.payment_method || "unpaid").toUpperCase()}</span>
        </div>
        <div class="divider"></div>
        <p style="text-align: center; font-size: 0.8em;">Thank you!</p>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
}

const STATUS_FILTERS = [
  "all",
  "pending",
  "preparing",
  "ready",
  "completed",
] as const;

export function OrdersPage() {
  const router = useRouter();
  const { data: loyaltySettings } = useLoyaltySettings();
  const formatArk = (value: number) =>
    formatArkAmount(value, loyaltySettings?.ark_rate || 1000);
  const { data: orders = [], isLoading, refetch } = useOrderList({ limit: 100 });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(false);

  const isPaid = (order: Order) =>
    order.payment_status === "paid" || order.status === "completed";

  const statusCounts = useMemo(
    () => ({
      all: orders.length,
      pending: orders.filter((o) => o.status === "pending").length,
      preparing: orders.filter((o) => o.status === "preparing").length,
      ready: orders.filter((o) => o.status === "ready").length,
      completed: orders.filter((o) => isPaid(o)).length,
    }),
    [orders]
  );

  const filteredOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesSearch =
        !q ||
        order.order_number?.toLowerCase().includes(q) ||
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

  const openDetail = (order: Order) => {
    setSelectedOrder(order);
    setShowDetailModal(true);
  };

  const isActiveOrder = (order: Order) =>
    !!order.status &&
    !["completed", "cancelled", "voided", "merged"].includes(order.status) &&
    order.payment_status !== "paid";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Browse transaction history and manage open orders
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {(
          [
            ["all", "All", statusCounts.all, "text-foreground"],
            ["pending", "Pending", statusCounts.pending, "text-amber-700"],
            ["preparing", "Preparing", statusCounts.preparing, "text-sky-700"],
            ["ready", "Ready", statusCounts.ready, "text-violet-700"],
            ["completed", "Lunas", statusCounts.completed, "text-emerald-700"],
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
                placeholder="Search order, customer, or cashier…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 border-gray-200/80 bg-white pl-10"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Showing {filteredOrders.length} of {orders.length} orders
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading orders…
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200/80 bg-muted/20 px-4 py-16 text-center text-sm text-muted-foreground">
              No orders found
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
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-gray-200/70 last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-foreground">
                        <div>{order.order_number}</div>
                        {order.queue_number ? (
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
                        {order.items?.length || 0}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentBadge method={order.payment_method} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                        {formatCurrency(order.total_amount || 0)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={order.status} />
                          {isPaid(order) ? (
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
                          {order.status === "pending" ? (
                            <Button
                              type="button"
                              size="icon"
                              className="h-8 w-8 bg-primary hover:bg-primary/90"
                              title="Open in cashier"
                              onClick={() =>
                                router.push(
                                  `/dashboard/pos/cashier-new?orderId=${order.id}`
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
                            onClick={() => openDetail(order)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {isActiveOrder(order) ? (
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
                  ))}
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
          if (!open) setSelectedOrder(null);
        }}
      >
        <DialogPanel size="xl">
          <DialogPanelHeader>
            <DialogPanelTitle>Order detail</DialogPanelTitle>
            <DialogPanelDescription>
              {selectedOrder?.order_number || "Order"} ·{" "}
              {selectedOrder?.ordered_at
                ? formatDate(selectedOrder.ordered_at)
                : "—"}
            </DialogPanelDescription>
          </DialogPanelHeader>
          <DialogPanelBody>
            {selectedOrder ? <OrderDetail order={selectedOrder} /> : null}
          </DialogPanelBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-gray-200/80"
              onClick={() => {
                if (!selectedOrder) return;
                printReceiptPreview(selectedOrder);
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
        }}
        onSuccess={() => {
          void refetch();
          setSelectedOrder(null);
        }}
      />
    </div>
  );
}

function OrderDetail({ order }: { order: Order }) {
  const { data: loyaltySettings } = useLoyaltySettings();
  const formatArk = (value: number) =>
    formatArkAmount(value, loyaltySettings?.ark_rate || 1000);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoTile label="Order" value={order.order_number || "—"} mono />
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
            <PaymentBadge method={order.payment_method} />
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

      <section className="overflow-hidden rounded-xl border border-gray-200/70 bg-white">
        <div className="border-b border-gray-200/70 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Items</h3>
        </div>
        <div className="divide-y divide-gray-200/70">
          {(order.items || []).map((item, idx) => (
            <div
              key={item.id || `${item.product_id}-${idx}`}
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
      </section>

      <section className="rounded-xl border border-gray-200/70 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Payment summary
        </h3>
        <div className="space-y-2 text-sm">
          <SummaryRow label="Subtotal" value={formatCurrency(order.subtotal || 0)} />
          {(order.discount_amount || 0) > 0 ? (
            <SummaryRow
              label="Discount"
              value={`−${formatCurrency(order.discount_amount || 0)}`}
              tone="text-emerald-600"
            />
          ) : null}
          {(order.tax_amount || 0) > 0 ? (
            <SummaryRow label="Tax" value={formatCurrency(order.tax_amount || 0)} />
          ) : null}
          {(order.ark_coins_used || 0) > 0 ? (
            <SummaryRow
              label="ARK used"
              value={`−${formatArk(order.ark_coins_used || 0)}`}
              tone="text-amber-700"
            />
          ) : null}
          <div className="flex items-center justify-between border-t border-gray-200/70 pt-2 text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums text-primary">
              {formatCurrency(order.total_amount || 0)}
            </span>
          </div>
          <SummaryRow label="Paid" value={formatCurrency(order.amount_paid || 0)} />
          {(order.change_amount || 0) > 0 ? (
            <SummaryRow
              label="Change"
              value={formatCurrency(order.change_amount || 0)}
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
