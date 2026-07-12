"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ClipboardList,
  Clock,
  CreditCard,
  Loader2,
  MessageSquare,
  MoveRight,
  Printer,
  ReceiptText,
  Split,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { printThermalReceipt, type ReceiptPayload } from "@/components/pos/PrintReceipt";
import { cashierQueryKeys } from "@/features/pos/cashier/query-keys";
import type { Order } from "@/features/pos/open-bills/types";
import { preSettleOrder } from "@/lib/pos-api";
import type { PosTable } from "@/lib/pos-api";
import { cn } from "@/lib/utils";

import { orderToPreviewReceipt } from "../order-to-receipt";
import { billSelection } from "../selection";
import type { NullableRestaurantSelection, RestaurantSelection } from "../selection";
import { getActiveSplitSummary } from "@/features/pos/open-bills/split-summary";
import { PreviewBillDialog } from "./preview-bill-dialog";
import { ViewOrdersDialog } from "./view-orders-dialog";

const LAST_RECEIPT_KEY = "pos:lastReceipt";

function resolvePreviewTableLabel(order: Order, tableId?: string | null) {
  if (order.table?.table_number) return order.table.table_number;
  if (order.table?.qr_code) return order.table.qr_code;
  if (tableId) return `Table ${tableId.slice(0, 8)}`;
  if (order.table_id) return `Table ${order.table_id.slice(0, 8)}`;
  return null;
}

function useLiveClock() {
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Stable placeholder matches SSR + first client render (avoids hydration mismatch).
  return clock ?? "--:--:--";
}

export interface RestaurantActionRailProps {
  selection: NullableRestaurantSelection;
  selectedOrder: Order | null;
  selectedTableLabel?: string | null;
  tablesById: Map<string, PosTable>;
  availableCount: number;
  occupiedCount: number;
  onSplitBill: () => void;
  onPaySplits: () => void;
  onMoveTable: () => void;
  onSelectBill: (selection: RestaurantSelection) => void;
}

export function RestaurantActionRail({
  selection,
  selectedOrder,
  selectedTableLabel,
  tablesById,
  availableCount,
  occupiedCount,
  onSplitBill,
  onPaySplits,
  onMoveTable,
  onSelectBill,
}: RestaurantActionRailProps) {
  const queryClient = useQueryClient();
  const clock = useLiveClock();
  const orderId = selection?.orderId;
  const splitSummary = getActiveSplitSummary(selectedOrder?.splits);
  const [preSettling, setPreSettling] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<ReceiptPayload | null>(
    null
  );
  const [previewMode, setPreviewMode] = useState<"order-check" | "pre-settlement">(
    "pre-settlement"
  );
  const [viewOrdersOpen, setViewOrdersOpen] = useState(false);

  const buildPreviewPayload = () => {
    if (!selectedOrder) return null;
    return orderToPreviewReceipt(
      selectedOrder,
      selectedTableLabel ||
        resolvePreviewTableLabel(selectedOrder, selection?.tableId)
    );
  };

  const openPreview = (mode: "order-check" | "pre-settlement") => {
    const payload = buildPreviewPayload();
    if (!payload) {
      toast.error("Bill details unavailable for this selection.");
      return;
    }
    setPreviewMode(mode);
    setPreviewPayload(payload);
    setPreviewOpen(true);
  };

  const requireSelection = () => {
    if (orderId) return true;
    toast.error("Select an occupied table or bill");
    return false;
  };

  const handleOrderCheck = () => {
    if (!requireSelection()) return;
    openPreview("order-check");
  };

  const handlePreSettlement = async () => {
    if (!requireSelection() || !orderId || preSettling) return;
    try {
      setPreSettling(true);
      const res = await preSettleOrder(orderId);
      if (!res.success) {
        toast.error(res.error || "Failed to mark pre settlement");
        return;
      }
      toast.success(res.message || "Pre settlement marked");
      await queryClient.invalidateQueries({ queryKey: cashierQueryKeys.tables() });

      if (!selectedOrder) {
        toast.message("Pre settlement saved. Preview bill unavailable for this selection.");
        return;
      }

      openPreview("pre-settlement");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to mark pre settlement"
      );
    } finally {
      setPreSettling(false);
    }
  };

  const handleSplitBill = () => {
    if (!selectedOrder) {
      toast.error("Select an occupied table or bill");
      return;
    }
    if (splitSummary) {
      onPaySplits();
      return;
    }
    onSplitBill();
  };

  const handleMoveTable = () => {
    if (!selectedOrder) {
      toast.error("Select an occupied table or bill");
      return;
    }
    onMoveTable();
  };

  const handleReprint = () => {
    const raw = window.sessionStorage.getItem(LAST_RECEIPT_KEY);
    if (!raw) {
      toast.message("No recent receipt found to reprint.");
      return;
    }

    try {
      const payload = JSON.parse(raw) as ReceiptPayload;
      printThermalReceipt(payload, "CUSTOMER");
    } catch {
      toast.error("Could not read the last receipt.");
    }
  };

  const actions: Array<{
    key: string;
    label: string;
    icon: typeof CreditCard;
    onClick: () => void;
    loading?: boolean;
  }> = [
    {
      key: "waiting-list",
      label: "Waiting List",
      icon: Users,
      onClick: () => toast.message("Waiting List coming soon"),
    },
    { key: "order-check", label: "Order Check", icon: ReceiptText, onClick: handleOrderCheck },
    {
      key: "pre-settlement",
      label: "Pre Settlement",
      icon: CreditCard,
      onClick: handlePreSettlement,
      loading: preSettling,
    },
    {
      key: "split-bill",
      label: splitSummary
        ? `Pay Splits (${splitSummary.paid}/${splitSummary.total})`
        : "Split Bill",
      icon: Split,
      onClick: handleSplitBill,
    },
    { key: "move-table", label: "Move Table", icon: MoveRight, onClick: handleMoveTable },
    { key: "reprint", label: "Reprint", icon: Printer, onClick: handleReprint },
    {
      key: "message",
      label: "Message",
      icon: MessageSquare,
      onClick: () => toast.message("Message coming soon"),
    },
  ];

  const actionButtonClass =
    "h-auto w-full flex-col items-center justify-center gap-1.5 whitespace-normal rounded-lg border-gray-200/70 px-2 py-2.5 text-center text-[11px] font-medium leading-tight text-gray-700 hover:border-primary/30 hover:bg-primary/5 hover:text-primary";

  return (
    <aside className="flex h-fit flex-col gap-2 rounded-xl border border-gray-200/70 bg-white p-2.5 shadow-xs max-lg:grid max-lg:grid-cols-2 sm:max-lg:grid-cols-4">
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200/70 bg-gray-50/80 px-2 py-2.5",
          "max-lg:col-span-2 sm:max-lg:col-span-4"
        )}
      >
        <div className="flex items-center justify-center gap-2 text-sm font-semibold tabular-nums text-gray-900">
          <Clock className="size-3.5 shrink-0 text-muted-foreground" />
          {clock}
        </div>
        <p className="text-center text-[10px] font-medium leading-tight text-gray-500">
          {availableCount} available · {occupiedCount} occupied
        </p>
      </div>

      {actions.map((action) => (
        <Button
          key={action.key}
          type="button"
          variant="outline"
          className={actionButtonClass}
          onClick={action.onClick}
          disabled={Boolean(action.loading)}
        >
          {action.loading ? (
            <Loader2 className="size-4 shrink-0 animate-spin opacity-80" />
          ) : (
            <action.icon className="size-4 shrink-0 opacity-80" />
          )}
          <span>{action.loading ? "Saving..." : action.label}</span>
        </Button>
      ))}

      <Button
        type="button"
        variant="outline"
        className={cn(
          actionButtonClass,
          "border-primary/25 text-primary hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
          "max-lg:col-span-2 sm:max-lg:col-span-4"
        )}
        onClick={() => setViewOrdersOpen(true)}
      >
        <ClipboardList className="size-4 shrink-0" />
        <span>View Orders</span>
      </Button>

      <PreviewBillDialog
        open={previewOpen}
        payload={previewPayload}
        showPrint={previewMode === "pre-settlement"}
        title={previewMode === "order-check" ? "Order Check" : "Preview Bill"}
        descriptionPrefix={
          previewMode === "order-check"
            ? "Order check · unpaid"
            : "Pre-settlement · unpaid"
        }
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) setPreviewPayload(null);
        }}
      />

      <ViewOrdersDialog
        open={viewOrdersOpen}
        onOpenChange={setViewOrdersOpen}
        tablesById={tablesById}
        onSelectOrder={(order) => {
          onSelectBill(billSelection(order.id, order.table_id ?? undefined));
          toast.message(
            `Selected ${order.order_number || order.id.slice(0, 8)}.`
          );
        }}
      />
    </aside>
  );
}
