"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageTransition } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { useCashierTables } from "@/features/pos/cashier/queries";
import type { PosTable } from "@/lib/pos-api";

import { RestaurantTableBoard } from "./restaurant-table-board";

export function RestaurantPage() {
  const { data: tables = [], isLoading, error } = useCashierTables();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const tableError = error instanceof Error ? error.message : null;

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
    setSelectedTableId((current) => (current === table.id ? null : table.id));
    toast.message(`Selected ${table.label || table.table_number || "table"}.`, {
      description: "Double-click the table to open its bill in the cashier.",
    });
  };

  return (
    <PageTransition className="space-y-6">
      <PurchasingPageHeader
        title="Restaurant"
        description={`${availableCount} available · ${occupiedCount} occupied`}
      />

      <Card className="border-gray-200/70 shadow-xs">
        <CardContent className="p-4 sm:p-6">
          <RestaurantTableBoard
            tables={tables}
            isLoading={isLoading}
            error={tableError}
            selectedTableId={selectedTableId}
            onSelectOccupied={handleSelectOccupied}
          />
        </CardContent>
      </Card>
    </PageTransition>
  );
}
