"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageTransition } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { useCashierTables } from "@/features/pos/cashier/queries";
import type { PosTable } from "@/lib/pos-api";

import { RestaurantBillsRail } from "./restaurant-bills-rail";
import { RestaurantTableBoard } from "./restaurant-table-board";
import {
  isTableSelected,
  tableSelection,
  type NullableRestaurantSelection,
  type RestaurantSelection,
} from "../selection";

export function RestaurantPage() {
  const { data: tables = [], isLoading, error } = useCashierTables();
  const [selection, setSelection] = useState<NullableRestaurantSelection>(null);

  const tableError = error instanceof Error ? error.message : null;

  const tablesById = useMemo(() => {
    return new Map(tables.map((table) => [table.id, table]));
  }, [tables]);

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

  return (
    <PageTransition className="space-y-6">
      <PurchasingPageHeader
        title="Restaurant"
        description={`${availableCount} available · ${occupiedCount} occupied`}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
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
    </PageTransition>
  );
}
