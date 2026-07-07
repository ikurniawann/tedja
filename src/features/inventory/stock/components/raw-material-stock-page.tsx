"use client";

import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { RawMaterialStockTab } from "./raw-material-stock-tab";

export function RawMaterialStockPage() {
  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Raw Material Stock"
        description="Monitor raw material balances and stock values. Filter by stall to view stock per storage location."
      />
      <RawMaterialStockTab />
    </div>
  );
}
