// ============================================================
// Types for Raw Materials (Bahan Baku)
// ============================================================

export const KATEGORI_OPTIONS = [
  "BAHAN_PANGAN",
  "BAHAN_NON_PANGAN",
  "KEMASAN",
  "BAHAN_BAKAR",
  "LAINNYA",
] as const;

export const COA_OPTIONS = [
  { value: "PRODUCTION", label: "Produksi" },
  { value: "RND", label: "R&D" },
  { value: "ASSET", label: "Asset Perusahaan" },
] as const;

export type COA = "PRODUCTION" | "RND" | "ASSET";

export type Kategori = (typeof KATEGORI_OPTIONS)[number];

export const STOK_STATUS = {
  AMAN: "AMAN",
  MENIPIS: "MENIPIS",
  HABIS: "HABIS",
} as const;

export type StokStatus = (typeof STOK_STATUS)[keyof typeof STOK_STATUS];

// ─── Satuan ───────────────────────────────────────────────────────────────────

export interface Satuan {
  id: string;
  kode: string;
  nama: string;
  deskripsi?: string;
  is_active: boolean;
}

// ─── Supplier ────────────────────────────────────────────────────────────────

export interface SupplierMinimal {
  id: string;
  nama_supplier: string;
  pic_name?: string | null;
  pic_phone?: string | null;
  is_active?: boolean;
}

// ─── Stok Info ───────────────────────────────────────────────────────────────

export interface StokInfo {
  qty_onhand: number;
  qty_reserved: number;
  qty_on_order: number;
  avg_cost: number;
  qty_minimum: number;
  qty_maximum: number;
  konversi_factor: number;
  status_stok: StokStatus;
}

// ─── Inventory Movement ──────────────────────────────────────────────────────

export type MovementTipe = "in" | "out" | "adjustment" | "transfer" | "return";

export interface InventoryMovement {
  id: string;
  tipe: MovementTipe;
  jumlah: number;
  unit_cost: number | null;
  total_cost: number | null;
  sebelum: number;
  sesudah: number;
  reference_type: string | null;
  reference_id: string | null;
  alasan: string | null;
  tanggal_movement: string;
  catatan: string | null;
  created_at: string;
}

// ─── BOM Product ─────────────────────────────────────────────────────────────

export interface BomProduct {
  id: string;
  jumlah: number;
  waste_percentage: number;
  satuan: Satuan;
  produk: {
    id: string;
    kode: string;
    nama: string;
    is_active: boolean;
  };
}

// ─── Raw Material (List Item) ─────────────────────────────────────────────────

export interface RawMaterial {
  id: string;
  kode: string;
  nama: string;
  kategori: Kategori | null;
  coa: COA | null;
  minimum_stock: number;
  maximum_stock: number | null;
  konversi_factor: number;
  shelf_life_days: number;
  storage_condition: string;
  is_active: boolean;
  created_at: string;
  satuan_besar: Satuan;
  satuan_kecil: Satuan | null;
  // COA fields
  coa_production?: string;
  coa_rnd?: string;
  coa_asset?: string;
  // Enriched fields
  qty_onhand: number;
  avg_cost: number;
  status_stok: StokStatus;
  supplier_utama: {
    id: string;
    nama: string;
    harga: number;
  } | null;
}

// ─── Raw Material Detail ─────────────────────────────────────────────────────

export interface RawMaterialDetail extends RawMaterial {
  stok: StokInfo;
  movements: InventoryMovement[];
  bom_products: BomProduct[];
}

// ─── List Query Params ───────────────────────────────────────────────────────

export interface RawMaterialListParams {
  search?: string;
  kategori?: Kategori;
  satuan_besar_id?: string;
  is_active?: boolean;
  below_minimum?: boolean;
  page?: number;
  limit?: number;
  sort_by?: "kode_bahan" | "nama_bahan" | "kategori" | "created_at";
  sort_dir?: "ASC" | "DESC";
}

// ─── Form Input ──────────────────────────────────────────────────────────────

export interface CreateRawMaterialInput {
  kode_bahan: string;
  nama_bahan: string;
  kategori?: Kategori;
  coa?: COA;
  satuan_besar_id: string;
  satuan_kecil_id?: string;
  konversi_factor?: number;
  stok_minimum?: number;
  stok_maximum?: number;
  shelf_life_days?: number;
  storage_condition?: string;
  coa_production?: string;
  coa_rnd?: string;
  coa_asset?: string;
}

export interface UpdateRawMaterialInput {
  nama_bahan?: string;
  kategori?: Kategori;
  satuan_besar_id?: string;
  satuan_kecil_id?: string | null;
  konversi_factor?: number;
  stok_minimum?: number;
  stok_maximum?: number | null;
  shelf_life_days?: number;
  storage_condition?: string;
  coa_production?: string;
  coa_rnd?: string;
  coa_asset?: string;
}

// ─── Raw Material with Stock (for combobox) ─────────────────────────────────

export interface RawMaterialWithStock {
  id: string;
  kode: string;
  nama: string;
  kategori: Kategori | null;
  is_active: boolean;
  qty_onhand?: number;
  avg_cost?: number;
}
