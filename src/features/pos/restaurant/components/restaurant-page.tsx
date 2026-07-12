"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageTransition } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { useCashierTables } from "@/features/pos/cashier/queries";
import { useOpenBills } from "@/features/pos/open-bills/queries";
import { useCreateOrderSplits } from "@/features/pos/open-bills/mutations";
import type { Order } from "@/features/pos/open-bills/types";
import { MoveTableModal } from "@/components/pos/MoveTableModal";
import { SplitBillModal, type SplitConfig } from "@/components/pos/SplitBillModal";
import { SplitPaymentScreen } from "@/components/pos/SplitPaymentScreen";
import type { PosTable } from "@/lib/pos-api";

import { RestaurantActionRail } from "./restaurant-action-rail";
import { RestaurantBillsRail } from "./restaurant-bills-rail";
import { RestaurantTableBoard } from "./restaurant-table-board";
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
  const { data: tables = [], isLoading, error } = useCashierTables();
  const { data: orders = [], refetch: refetchOrders } = useOpenBills({ limit: 200 });
  const createSplitsMutation = useCreateOrderSplits();
  const [selection, setSelection] = useState<NullableRestaurantSelection>(null);
  const [showMoveModal, setShowMoveModal] = useState(false);
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
      if (table.status === "occupied") occupied += 1;
    }
    return { availableCount: available, occupiedCount: occupied };
  }, [tables]);

  const handleSelectOccupied = (table: PosTable) => {
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
    setSelection(nextSelection);
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create split bill");
    }
  };

  return (
    <PageTransition className="space-y-6">
      <PurchasingPageHeader
        title="Restaurant"
        description={`${availableCount} available · ${occupiedCount} occupied`}
      />

      <div className="grid gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_22rem]">
        <RestaurantActionRail
          selection={selection}
          selectedOrder={selectedOrder}
          onSplitBill={() => setShowSplitModal(true)}
          onMoveTable={() => setShowMoveModal(true)}
        />

        <Card className="border-gray-200/70 shadow-xs">
          <CardContent className="p-4 sm:p-6">
            <RestaurantTableBoard
              tables={tables}
              isLoading={isLoading}
              error={tableError}
              selectedTableId={selection?.tableId ?? null}
              onSelectOccupied={handleSelectOccupied}
            />
          </CardContent>
        </Card>

        <RestaurantBillsRail
          tablesById={tablesById}
          selection={selection}
          onSelect={handleSelectBill}
        />
      </div>

      <MoveTableModal
        open={showMoveModal}
        order={selectedOrder}
        allOrders={orders}
        onClose={() => setShowMoveModal(false)}
        onSuccess={() => {
          toast.success("Table moved.");
          void refetchOrders();
          setSelection(null);
        }}
      />

      <SplitBillModal
        open={showSplitModal}
        total={Number(selectedOrder?.total_amount || 0)}
        subtotal={Number(selectedOrder?.subtotal || selectedOrder?.total_amount || 0)}
        taxAmount={Number(selectedOrder?.tax_amount || 0)}
        discountAmount={Number(selectedOrder?.discount_amount || 0)}
        cartItems={splitCartItems}
        onClose={() => setShowSplitModal(false)}
        onConfirm={handleConfirmSplit}
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
