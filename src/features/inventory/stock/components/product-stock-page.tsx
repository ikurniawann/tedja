"use client";

import { PurchasingPageHeader } from "@/modules/purchasing/components/page/purchasing-page-header";
import { ProductStockTab } from "./product-stock-tab";

export function ProductStockPage() {
  return (
    <div className="space-y-6">
      <PurchasingPageHeader
        title="Product Stock"
        description="Monitor finished product balances, inventory value, and availability status per outlet."
      />
      <ProductStockTab />
    </div>
  );
}
