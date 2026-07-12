"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Merge,
  MoveRight,
  ReceiptText,
  RefreshCw,
  Search,
  Split,
  Table2,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Order } from "../types";
import { useOpenBills } from "../queries";
import { useCreateOrderSplits, useUpdateOrderPayment } from "../mutations";
import { MoveTableModal } from "@/components/pos/MoveTableModal";
import { MergeTableModal } from "@/components/pos/MergeTableModal";
import { VoidModal } from "@/components/pos/VoidModal";
import { SplitBillModal, type SplitConfig } from "@/components/pos/SplitBillModal";
import { SplitPaymentScreen } from "@/components/pos/SplitPaymentScreen";

type OpenBillItem = {
  id?: string;
  product_id?: string;
  product_name?: string;
  quantity?: number | string;
  unit_price?: number | string;
  subtotal?: number | string;
  total_amount?: number | string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function tableLabel(order: Order) {
  if (order.table?.table_number) return order.table.table_number;
  if (order.table?.qr_code) return order.table.qr_code;
  const request = order.special_requests || order.notes || "";
  const match = request.match(/Self-service table ([^;]+)/i);
  if (match?.[1]) return match[1].trim();
  return order.table_id ? `Table ${order.table_id.slice(0, 8)}` : "Tanpa meja";
}

function statusLabel(status?: string) {
  if (status === "confirmed") return "Dikonfirmasi";
  if (status === "preparing") return "Disiapkan";
  if (status === "ready") return "Siap";
  if (status === "served") return "Served";
  return "Pending";
}

function paymentStatusLabel(status?: string) {
  if (status === "partial") return "Partial";
  if (status === "paid") return "Paid";
  return "Unpaid";
}

export function OpenBillsPage() {
  const { data: orders = [], isLoading, isFetching, error: queryError, refetch } = useOpenBills({ limit: 200 });
  const updatePaymentMutation = useUpdateOrderPayment();
  const createSplitsMutation = useCreateOrderSplits();
  const loading = isLoading || isFetching;
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [settling, setSettling] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitPaymentOrder, setSplitPaymentOrder] = useState<Order | null>(null);

  const queryErrorMessage = queryError instanceof Error ? queryError.message : "";

  const openBills = useMemo(() => {
    const term = query.trim().toLowerCase();
    return orders
      .filter((order) => !["completed", "cancelled", "voided", "merged"].includes(order.status || ""))
      .filter((order) => (order.payment_status || "unpaid") !== "paid")
      .filter((order) => {
        if (!term) return true;
        return [
          order.order_number,
          tableLabel(order),
          order.customer?.name,
          order.notes,
          order.special_requests,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term);
      });
  }, [orders, query]);

  const summary = useMemo(() => {
    return {
      count: openBills.length,
      total: openBills.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
      tableCount: new Set(openBills.map(tableLabel)).size,
      partialCount: openBills.filter((order) => order.payment_status === "partial").length,
    };
  }, [openBills]);

  async function settlePayment() {
    if (!paymentOrder) return;
    const total = Number(paymentOrder.total_amount || 0);
    const paid = paymentMethod === "cash" ? Number(amountPaid || 0) : total;

    if (paymentMethod === "cash" && paid < total) {
      setError("Jumlah cash kurang dari total tagihan.");
      return;
    }

    try {
      setSettling(true);
      setError("");
      await updatePaymentMutation.mutateAsync({
        orderId: paymentOrder.id,
        payload: {
          payment_status: "paid",
          payment_method: paymentMethod,
          amount_paid: paid,
        },
      });
      setPaymentOrder(null);
      setAmountPaid("");
      setPaymentMethod("cash");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal settle pembayaran");
    } finally {
      setSettling(false);
    }
  }

  function openMove(order: Order) {
    setSelectedOrder(order);
    setShowMoveModal(true);
  }

  function openMerge(order: Order) {
    setSelectedOrder(order);
    setShowMergeModal(true);
  }

  function openVoid(order: Order) {
    setSelectedOrder(order);
    setShowVoidModal(true);
  }

  function openSplit(order: Order) {
    setSelectedOrder(order);
    setShowSplitModal(true);
  }

  const splitCartItems = useMemo(() => {
    if (!selectedOrder) return [];

    return ((selectedOrder.items || []) as OpenBillItem[]).map((item, index) => {
      const quantity = Number(item.quantity || 1);
      const totalAmount = Number(item.total_amount || item.subtotal || 0);
      const unitPrice = Number(item.unit_price || (quantity > 0 ? totalAmount / quantity : 0));

      return {
        id: item.id || `${item.product_id || "item"}-${index}`,
        productId: item.product_id || "",
        name: item.product_name || "Item",
        price: unitPrice,
        quantity,
      };
    });
  }, [selectedOrder]);

  async function handleConfirmSplit(config: SplitConfig) {
    if (!selectedOrder) return;

    try {
      setError("");
      await createSplitsMutation.mutateAsync({
        orderId: selectedOrder.id,
        payload: {
          splits: config.splits.map((split) => ({
            label: split.label,
            subtotal: split.subtotal || 0,
            tax_amount: split.tax_amount || 0,
            discount_amount: split.discount_amount || 0,
            total_amount: split.total,
            customer_id: split.customerId,
            items: split.items,
          })),
        },
      });
      setShowSplitModal(false);
      setSplitPaymentOrder(selectedOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat split bill");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950">Open Bills & Table</h1>
          <p className="text-sm text-gray-500">Kelola order dine-in yang belum selesai dari kasir dan QR meja.</p>
        </div>
        <Button onClick={() => void refetch()} variant="outline" disabled={loading} className="gap-2">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>

      {(error || queryErrorMessage) && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <AlertCircle className="size-4" />
          {error || queryErrorMessage}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={ReceiptText} label="Open Bill" value={summary.count.toLocaleString("id-ID")} tone="pink" />
        <Metric icon={WalletCards} label="Outstanding" value={formatCurrency(summary.total)} tone="emerald" />
        <Metric icon={Table2} label="Meja Aktif" value={summary.tableCount.toLocaleString("id-ID")} tone="blue" />
        <Metric icon={Clock} label="Partial Payment" value={summary.partialCount.toLocaleString("id-ID")} tone="amber" />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari order, meja, customer..."
            className="pl-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white py-20 text-sm text-gray-500">
          <Loader2 className="size-5 animate-spin" />
          Memuat open bill...
        </div>
      ) : openBills.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-20 text-center">
          <CheckCircle2 className="mx-auto size-10 text-pink-500" />
          <div className="mt-3 font-semibold text-gray-950">Tidak ada open bill</div>
          <div className="mt-1 text-sm text-gray-500">Semua order aktif sudah selesai atau dibayar.</div>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {openBills.map((order) => (
            <OpenBillCard
              key={order.id}
              order={order}
              onPay={() => setPaymentOrder(order)}
              onSplit={() => openSplit(order)}
              onMove={() => openMove(order)}
              onMerge={() => openMerge(order)}
              onVoid={() => openVoid(order)}
            />
          ))}
        </div>
      )}

      {paymentOrder && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-950">Settle Payment</h2>
                <p className="mt-1 text-sm text-gray-500">{paymentOrder.order_number} · {tableLabel(paymentOrder)}</p>
              </div>
              <Badge className="bg-pink-100 text-pink-700 hover:bg-pink-100">
                {formatCurrency(Number(paymentOrder.total_amount || 0))}
              </Badge>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ["cash", "Cash"],
                ["qris", "QRIS"],
                ["credit", "Card"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPaymentMethod(value)}
                  className={`rounded-lg border px-3 py-3 text-sm font-semibold transition ${
                    paymentMethod === value
                      ? "border-pink-600 bg-pink-50 text-pink-700"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {paymentMethod === "cash" && (
              <label className="mt-4 block">
                <span className="text-sm font-semibold text-gray-700">Cash diterima</span>
                <Input
                  type="number"
                  value={amountPaid}
                  onChange={(event) => setAmountPaid(event.target.value)}
                  placeholder="0"
                  className="mt-2"
                />
                <span className="mt-2 block text-sm text-gray-500">
                  Kembalian: {formatCurrency(Math.max(0, Number(amountPaid || 0) - Number(paymentOrder.total_amount || 0)))}
                </span>
              </label>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPaymentOrder(null)} disabled={settling}>
                Batal
              </Button>
              <Button className="flex-1 bg-pink-600 hover:bg-pink-700" onClick={settlePayment} disabled={settling}>
                {settling ? "Memproses..." : "Konfirmasi Bayar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <MoveTableModal
        open={showMoveModal}
        order={selectedOrder}
        allOrders={orders}
        onClose={() => {
          setShowMoveModal(false);
          setSelectedOrder(null);
        }}
        onSuccess={() => {
          void refetch();
          setSelectedOrder(null);
        }}
      />

      <MergeTableModal
        open={showMergeModal}
        order={selectedOrder}
        allOrders={orders}
        onClose={() => {
          setShowMergeModal(false);
          setSelectedOrder(null);
        }}
        onSuccess={() => {
          void refetch();
          setSelectedOrder(null);
        }}
      />

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

      <SplitBillModal
        open={showSplitModal}
        total={Number(selectedOrder?.total_amount || 0)}
        subtotal={Number(selectedOrder?.subtotal || selectedOrder?.total_amount || 0)}
        taxAmount={Number(selectedOrder?.tax_amount || 0)}
        discountAmount={Number(selectedOrder?.discount_amount || 0)}
        cartItems={splitCartItems}
        onClose={() => {
          setShowSplitModal(false);
          setSelectedOrder(null);
        }}
        onConfirm={handleConfirmSplit}
        confirming={createSplitsMutation.isPending}
        formatCurrency={formatCurrency}
      />

      {splitPaymentOrder && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white p-4 lg:p-6">
          <SplitPaymentScreen
            orderId={splitPaymentOrder.id}
            orderNumber={splitPaymentOrder.order_number}
            orderType={splitPaymentOrder.order_type}
            table={tableLabel(splitPaymentOrder)}
            items={splitPaymentOrder.items || []}
            notes={splitPaymentOrder.notes}
            total={Number(splitPaymentOrder.total_amount || 0)}
            taxAmount={Number(splitPaymentOrder.tax_amount || 0)}
            discountAmount={Number(splitPaymentOrder.discount_amount || 0)}
            customerName={splitPaymentOrder.customer?.name}
            onBack={() => setSplitPaymentOrder(null)}
            onComplete={() => {
              setSplitPaymentOrder(null);
              void refetch();
            }}
            formatCurrency={formatCurrency}
            formatArk={(value) => `${(value / 1000).toLocaleString("id-ID")} ARK`}
          />
        </div>
      )}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof ReceiptText;
  label: string;
  value: string;
  tone: "pink" | "emerald" | "blue" | "amber";
}) {
  const toneClass = {
    pink: "bg-pink-50 text-pink-600",
    emerald: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
  }[tone];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex size-10 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-sm text-gray-500">{label}</div>
          <div className="text-xl font-bold text-gray-950">{value}</div>
        </div>
      </div>
    </div>
  );
}

function OpenBillCard({
  order,
  onPay,
  onSplit,
  onMove,
  onMerge,
  onVoid,
}: {
  order: Order;
  onPay: () => void;
  onSplit: () => void;
  onMove: () => void;
  onMerge: () => void;
  onVoid: () => void;
}) {
  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-base font-bold text-gray-950">{order.order_number}</h2>
            <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">{statusLabel(order.status)}</Badge>
            <Badge variant="outline" className="border-pink-200 bg-pink-50 text-pink-700">
              {paymentStatusLabel(order.payment_status)}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Table2 className="size-4" />
              {tableLabel(order)}
            </span>
            <span>{formatDateTime(order.ordered_at)}</span>
            <span>{order.customer?.name || "Walk-in / Guest"}</span>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-sm text-gray-500">Outstanding</div>
          <div className="text-xl font-bold text-gray-950">{formatCurrency(Number(order.total_amount || 0))}</div>
        </div>
      </div>

      <div className="mt-4 divide-y divide-gray-100 rounded-lg bg-gray-50 px-3">
        {(order.items || []).slice(0, 4).map((item, index) => (
          <div key={`${item.id || item.product_id}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-semibold text-gray-900">{item.product_name}</div>
              <div className="text-xs text-gray-500">{item.quantity} x {formatCurrency(Number(item.unit_price || 0))}</div>
            </div>
            <div className="shrink-0 font-semibold text-gray-900">
              {formatCurrency(Number(item.total_amount || item.subtotal || 0))}
            </div>
          </div>
        ))}
        {(order.items?.length || 0) > 4 && (
          <div className="py-2 text-xs font-semibold text-gray-500">+{(order.items?.length || 0) - 4} item lainnya</div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button className="gap-2 bg-pink-600 hover:bg-pink-700" onClick={onPay}>
          <CreditCard className="size-4" />
          Bayar
        </Button>
        <Button variant="outline" className="gap-2 border-pink-200 text-pink-700 hover:bg-pink-50" onClick={onSplit}>
          <Split className="size-4" />
          Split
        </Button>
        <Button variant="outline" className="gap-2" onClick={onMove}>
          <MoveRight className="size-4" />
          Pindah
        </Button>
        <Button variant="outline" className="gap-2" onClick={onMerge}>
          <Merge className="size-4" />
          Gabung
        </Button>
        <Button variant="outline" className="gap-2 border-red-200 text-red-700 hover:bg-red-50" onClick={onVoid}>
          <Ban className="size-4" />
          Void
        </Button>
      </div>
    </article>
  );
}
