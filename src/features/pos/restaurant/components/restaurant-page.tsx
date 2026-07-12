"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/24/outline";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PageTransition } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cashierQueryKeys } from "@/features/pos/cashier/query-keys";
import { useCashierTables } from "@/features/pos/cashier/queries";
import { useOpenBills } from "@/features/pos/open-bills/queries";
import { openBillsQueryKeys } from "@/features/pos/open-bills/query-keys";
import { useCreateOrderSplits } from "@/features/pos/open-bills/mutations";
import type { Order } from "@/features/pos/open-bills/types";
import { SplitBillModal, type SplitConfig } from "@/components/pos/SplitBillModal";
import { SplitPaymentScreen } from "@/components/pos/SplitPaymentScreen";
import { moveOrderTable, type PosTable } from "@/lib/pos-api";
import { cn } from "@/lib/utils";

import { RestaurantActionRail } from "./restaurant-action-rail";
import { RestaurantBillsRail } from "./restaurant-bills-rail";
import { RestaurantTableBoard } from "./restaurant-table-board";
import {
  isRestaurantImmersive,
  restaurantPath,
} from "../nav";
import {
  isTableSelected,
  tableSelection,
  type NullableRestaurantSelection,
  type RestaurantSelection,
} from "../selection";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);

type OpenBillItem = {
  id?: string;
  product_id?: string;
  product_name?: string;
  quantity?: number | string;
  unit_price?: number | string;
  subtotal?: number | string;
  total_amount?: number | string;
};

export function RestaurantPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-6 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading restaurant...
        </div>
      }
    >
      <RestaurantPageContent />
    </Suspense>
  );
}

function RestaurantPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const immersive = isRestaurantImmersive(searchParams);
  const { data: tables = [], isLoading, error } = useCashierTables();
  const { data: orders = [], refetch: refetchOrders } = useOpenBills({ limit: 200 });
  const createSplitsMutation = useCreateOrderSplits();
  const [selection, setSelection] = useState<NullableRestaurantSelection>(null);
  const [moveMode, setMoveMode] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitPaymentOrder, setSplitPaymentOrder] = useState<Order | null>(null);

  const tableError = error instanceof Error ? error.message : null;

  const tablesById = useMemo(() => {
    return new Map(tables.map((table) => [table.id, table]));
  }, [tables]);

  const selectedOrder = useMemo(() => {
    if (!selection?.orderId) return null;
    return orders.find((order) => order.id === selection.orderId) ?? null;
  }, [orders, selection]);

  const selectedTableLabel = useMemo(() => {
    if (!selection?.tableId) return null;
    const table = tablesById.get(selection.tableId);
    return table?.label || table?.table_number || table?.name || null;
  }, [selection?.tableId, tablesById]);

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

  const { availableCount, occupiedCount } = useMemo(() => {
    let available = 0;
    let occupied = 0;
    for (const table of tables) {
      if (table.status === "available") available += 1;
      if (table.status === "occupied" || table.status === "billing") occupied += 1;
    }
    return { availableCount: available, occupiedCount: occupied };
  }, [tables]);

  const exitMoveMode = () => {
    setMoveMode(false);
    setMoving(false);
  };

  const handleSelectOccupied = (table: PosTable) => {
    if (moveMode) {
      exitMoveMode();
    }
    const alreadySelected = isTableSelected(selection, table.id);
    setSelection(
      alreadySelected ? null : tableSelection(table.id, table.active_order?.id)
    );
    if (alreadySelected) {
      toast.message("Cleared table selection.");
      return;
    }

    toast.message(`Selected ${table.label || table.table_number || "table"}.`, {
      description: "Double-click the table to open its bill in the cashier.",
    });
  };

  const handleSelectBill = (nextSelection: RestaurantSelection) => {
    if (moveMode) {
      exitMoveMode();
    }
    setSelection(nextSelection);
  };

  const handleStartMove = () => {
    if (moveMode) {
      exitMoveMode();
      toast.message("Move cancelled.");
      return;
    }
    setMoveMode(true);
    toast.message("Select an available table.", {
      description: "Tap a green table on the floor plan to move this bill.",
    });
  };

  const handlePickDestination = async (table: PosTable) => {
    if (!selectedOrder || moving) return;

    const label = table.label || table.table_number || table.name || "table";
    try {
      setMoving(true);
      const res = await moveOrderTable(selectedOrder.id, table.id);
      if (!res.success) {
        toast.error(res.error || "Failed to move table");
        return;
      }
      toast.success(`Moved to ${label}.`);
      exitMoveMode();
      setSelection(null);
      void queryClient.invalidateQueries({ queryKey: cashierQueryKeys.tables() });
      void queryClient.invalidateQueries({ queryKey: openBillsQueryKeys.all });
      void refetchOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to move table");
    } finally {
      setMoving(false);
    }
  };

  const toggleImmersive = () => {
    router.replace(restaurantPath({ immersive: !immersive }));
  };

  const handleConfirmSplit = async (config: SplitConfig) => {
    if (!selectedOrder) return;

    try {
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
      toast.success("Split bill created.");
      setShowSplitModal(false);
      setSplitPaymentOrder(selectedOrder);
      void refetchOrders();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create split bill");
    }
  };

  return (
    <PageTransition
      className={cn("space-y-3", immersive ? "p-3 sm:p-4" : "space-y-4")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">Restaurant</h1>
          {immersive ? (
            <p className="text-xs text-muted-foreground">
              Immersive mode — dashboard chrome hidden
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0 border-gray-200/80 text-gray-700 hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
          onClick={toggleImmersive}
        >
          {immersive ? (
            <>
              <ArrowsPointingInIcon className="mr-2 h-4 w-4" />
              Exit Fullscreen
            </>
          ) : (
            <>
              <ArrowsPointingOutIcon className="mr-2 h-4 w-4" />
              Fullscreen
            </>
          )}
        </Button>
      </div>

      {moveMode && selectedOrder ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Move {selectedOrder.order_number} — tap an available table
            </p>
            <p className="text-xs text-muted-foreground">
              {moving
                ? "Moving…"
                : selectedTableLabel
                  ? `From ${selectedTableLabel}`
                  : "Choose a free table on the floor plan"}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 border-gray-200/80"
            onClick={() => {
              exitMoveMode();
              toast.message("Move cancelled.");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-3 lg:grid-cols-[184px_1fr_280px]",
          immersive
            ? "h-[calc(100dvh-4.5rem)] min-h-[560px]"
            : "min-h-[70vh]"
        )}
      >
        <RestaurantActionRail
          selection={selection}
          selectedOrder={selectedOrder}
          selectedTableLabel={selectedTableLabel}
          tablesById={tablesById}
          availableCount={availableCount}
          occupiedCount={occupiedCount}
          onSplitBill={() => setShowSplitModal(true)}
          onPaySplits={() => {
            if (!selectedOrder) {
              toast.error("Select an occupied table or bill");
              return;
            }
            setSplitPaymentOrder(selectedOrder);
          }}
          onMoveTable={handleStartMove}
          onSelectBill={handleSelectBill}
        />

        <Card className="min-h-0 min-w-0 overflow-auto border-gray-200/70 shadow-xs">
          <CardContent className="p-4 sm:p-6">
            <RestaurantTableBoard
              tables={tables}
              isLoading={isLoading}
              error={tableError}
              selectedTableId={selection?.tableId ?? null}
              immersive={immersive}
              moveMode={moveMode}
              moving={moving}
              sourceTableId={selection?.tableId ?? null}
              onSelectOccupied={handleSelectOccupied}
              onPickDestination={handlePickDestination}
            />
          </CardContent>
        </Card>

        <RestaurantBillsRail
          tablesById={tablesById}
          selection={selection}
          immersive={immersive}
          onSelect={handleSelectBill}
          onPaySplits={(order) => setSplitPaymentOrder(order)}
        />
      </div>

      <SplitBillModal
        open={showSplitModal}
        total={Number(selectedOrder?.total_amount || 0)}
        subtotal={Number(selectedOrder?.subtotal || selectedOrder?.total_amount || 0)}
        taxAmount={Number(selectedOrder?.tax_amount || 0)}
        discountAmount={Number(selectedOrder?.discount_amount || 0)}
        cartItems={splitCartItems}
        onClose={() => setShowSplitModal(false)}
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
            table={splitPaymentOrder.table?.table_number || splitPaymentOrder.table?.qr_code}
            items={splitPaymentOrder.items || []}
            notes={splitPaymentOrder.notes}
            total={Number(splitPaymentOrder.total_amount || 0)}
            taxAmount={Number(splitPaymentOrder.tax_amount || 0)}
            discountAmount={Number(splitPaymentOrder.discount_amount || 0)}
            customerName={splitPaymentOrder.customer?.name}
            onBack={() => setSplitPaymentOrder(null)}
            onComplete={() => {
              setSplitPaymentOrder(null);
              setSelection(null);
              void refetchOrders();
            }}
            formatCurrency={formatCurrency}
            formatArk={(value) => `${(value / 1000).toLocaleString("id-ID")} ARK`}
          />
        </div>
      )}
    </PageTransition>
  );
}
