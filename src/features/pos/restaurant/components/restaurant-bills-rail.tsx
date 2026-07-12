"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, ReceiptText, Table2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOpenBills } from "@/features/pos/open-bills/queries";
import type { Order } from "@/features/pos/open-bills/types";
import { cn } from "@/lib/utils";
import type { PosTable } from "@/lib/pos-api";

import { buildCashierHandoffUrl } from "../nav";
import {
  billSelection,
  isBillSelected,
  type NullableRestaurantSelection,
  type RestaurantSelection,
} from "../selection";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);

function formatRelativeTime(value?: string) {
  if (!value) return "-";

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "-";

  const diffMinutes = Math.round((time - Date.now()) / 60000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }

  return formatter.format(Math.round(diffHours / 24), "day");
}

function getTableDisplayName(table?: PosTable) {
  return table?.label || table?.table_number || table?.name || null;
}

function resolveOrderTableLabel(order: Order, tablesById: Map<string, PosTable>) {
  if (order.table_id) {
    const tableName = getTableDisplayName(tablesById.get(order.table_id));
    if (tableName) return tableName;
  }

  if (order.table?.table_number) return order.table.table_number;
  if (order.table?.qr_code) return order.table.qr_code;
  return order.table_id ? `Table ${order.table_id.slice(0, 8)}` : "Without table";
}

function isOpenBill(order: Order) {
  return (
    !["completed", "cancelled", "voided", "merged"].includes(order.status || "") &&
    (order.payment_status || "unpaid") !== "paid"
  );
}

export interface RestaurantBillsRailProps {
  tablesById: Map<string, PosTable>;
  selection: NullableRestaurantSelection;
  onSelect: (selection: RestaurantSelection) => void;
}

export function RestaurantBillsRail({
  tablesById,
  selection,
  onSelect,
}: RestaurantBillsRailProps) {
  const router = useRouter();
  const { data: orders = [], isLoading, error } = useOpenBills({
    limit: 200,
  });

  const openBills = useMemo(() => orders.filter(isOpenBill), [orders]);
  const loading = isLoading;
  const errorMessage = error instanceof Error ? error.message : null;

  const openBill = (order: Order) => {
    router.push(
      buildCashierHandoffUrl({
        orderId: order.id,
        tableId: order.table_id,
      })
    );
  };

  return (
    <aside className="min-w-0 rounded-xl border border-gray-200/70 bg-white shadow-xs">
      <div className="border-b border-gray-200/70 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-950">Open Bills</h2>
            <p className="text-xs text-muted-foreground">
              Select a bill to use restaurant actions.
            </p>
          </div>
          <Badge variant="outline" className="border-primary/20 text-primary">
            {openBills.length}
          </Badge>
        </div>
      </div>

      <div className="min-h-[220px] space-y-3 overflow-y-auto p-3 lg:max-h-[calc(100vh-18rem)]">
        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200/70 bg-gray-50/80 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading open bills...
          </div>
        ) : errorMessage ? (
          <div className="rounded-lg border border-red-200/80 bg-red-50 p-4 text-sm font-medium text-red-600">
            {errorMessage}
          </div>
        ) : openBills.length === 0 ? (
          <div className="rounded-lg border border-gray-200/70 bg-gray-50/80 p-6 text-center">
            <ReceiptText className="mx-auto size-8 text-muted-foreground" />
            <div className="mt-3 text-sm font-semibold text-gray-950">
              No open bills
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Active restaurant bills will appear here.
            </p>
          </div>
        ) : (
          openBills.map((order) => {
            const selected = isBillSelected(selection, order.id);
            const tableLabel = resolveOrderTableLabel(order, tablesById);

            return (
              <article
                key={order.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(billSelection(order.id, order.table_id))}
                onDoubleClick={() => openBill(order)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") openBill(order);
                }}
                className={cn(
                  "rounded-lg border bg-white p-3 text-left shadow-xs transition-all",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                    : "border-gray-200/70 hover:border-primary/30 hover:bg-primary/5"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-bold text-gray-950">
                      {order.order_number || order.id.slice(0, 8)}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Table2 className="size-3.5" />
                      <span className="truncate">{tableLabel}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm font-bold text-gray-950">
                    {formatCurrency(Number(order.total_amount || 0))}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3.5" />
                    {formatRelativeTime(order.ordered_at)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 border-primary/20 px-2 text-xs text-primary hover:bg-primary/5"
                    onClick={(event) => {
                      event.stopPropagation();
                      openBill(order);
                    }}
                  >
                    Open
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}
