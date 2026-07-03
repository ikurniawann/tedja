export type ProductionProduct = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  hpp_estimasi?: number | string | null;
  harga_jual?: number | string | null;
  total_bahan_baku?: number | string | null;
  production_output_type?: "FINISHED_GOOD" | "WIP" | null;
};

export type CogsMaterial = {
  bahan_id: string;
  kode: string;
  nama: string;
  material_type?: "PURCHASED" | "WIP" | string;
  source_product_id?: string | null;
  jumlah: number;
  satuan: string;
  qty_available: number;
  qty_on_order: number;
  unit_cost: number;
  waste_percentage: number;
  effective_qty: number;
  subtotal: number;
};

export type CogsData = {
  hpp_per_unit: number;
  total_bom_cost: number;
  total_overhead: number;
  breakdown_bahan: CogsMaterial[];
};

export type ProductionOrder = {
  id: string;
  nomor_produksi: string;
  production_context?: "product" | "raw_material";
  output_type?: "FINISHED_GOOD" | "WIP";
  product_nama?: string | null;
  product_kode?: string | null;
  output_raw_material_nama?: string | null;
  output_raw_material_kode?: string | null;
  item_nama?: string | null;
  item_kode?: string | null;
  planned_qty: number | string;
  actual_qty: number | string;
  status: string;
  planned_material_cost: number | string;
  actual_material_cost: number | string;
  hpp_per_unit: number | string;
  created_at: string;
};

export type WipInventory = {
  id: string;
  kode: string;
  nama: string;
  kategori: string;
  satuan: string;
  qty_onhand: number | string;
  avg_cost: number | string;
  status_stok: string;
  source_product_id?: string | null;
  source_product?: {
    id: string;
    kode?: string | null;
    nama?: string | null;
    kategori?: string | null;
  } | null;
  latest_batch?: {
    batch_number?: string | null;
    qty_produced?: number | string | null;
    hpp_per_unit?: number | string | null;
    production_order_id?: string | null;
    production_order_number?: string | null;
    created_at?: string | null;
  } | null;
};

export type WipSummary = {
  total_wip: number;
  ready_wip: number;
  total_qty: number;
  total_value: number;
};

export type ProductRecipe = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  harga_jual?: number | string | null;
  hpp_estimasi?: number | string | null;
  total_bahan_baku?: number | string | null;
  is_active?: boolean | null;
};

export type RawMaterialRecipe = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  avg_cost?: number | string | null;
  hpp_estimasi?: number | string | null;
  total_bahan_baku?: number | string | null;
  is_active?: boolean | null;
};

export interface ProductionDashboardData {
  orders: ProductionOrder[];
  products: ProductionProduct[];
  wipInventory: WipInventory[];
  wipSummary: WipSummary | null;
}

export interface CreateProductionOrderPayload {
  production_context?: "product" | "raw_material";
  product_id?: string;
  raw_material_id?: string;
  output_type?: "FINISHED_GOOD" | "WIP";
  planned_qty: number;
  overhead_cost: number;
  labor_cost: number;
  packaging_cost: number;
}
