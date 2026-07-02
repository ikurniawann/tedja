"use client";

import { ProductStockTab } from "./product-stock-tab";

export function ProductStockPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Product Stock</h1>
        <p className="text-sm text-gray-500">
          Pantau saldo stok produk jadi beserta nilai persediaan dan status ketersediaan
          per outlet.
        </p>
      </div>

      <ProductStockTab />
    </div>
  );
}
