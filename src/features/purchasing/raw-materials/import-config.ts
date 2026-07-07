/** Master category codes — must exist in raw material categories (see items-raw-material-categories seeder). */
export const RAW_MATERIAL_IMPORT_CATEGORY_HINT =
  "SAYUR, DAGING, SEAFOOD, DAIRY, BUMBU, KERING, MINUMAN, SAUS, BAKERY, BEKU, OIL, PROTEIN, KEMASAN, NONPANG, BAKAR, LAIN";

export const RAW_MATERIAL_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Code",
    required: false,
    description: "Leave empty to auto-generate BHN-YYYY-####",
  },
  { key: "nama", label: "Name", required: true },
  {
    key: "kategori",
    label: "Category Code",
    required: true,
    description: RAW_MATERIAL_IMPORT_CATEGORY_HINT,
  },
  {
    key: "satuan_besar_kode",
    label: "Large Unit Code",
    required: true,
    description: "Must match unit master (e.g. KG, SACK, DOS, TRAY)",
  },
  {
    key: "satuan_kecil_kode",
    label: "Small Unit Code",
    required: false,
    description: "Base/stock unit (e.g. GR, ML, PCS). Leave empty if same as large unit.",
  },
  {
    key: "konversi_factor",
    label: "Conversion Factor",
    required: false,
    type: "number" as const,
    description: "Small units per 1 large unit (e.g. 1 SACK = 25 KG → 25)",
  },
  { key: "stok_minimum", label: "Minimum Stock", required: false, type: "number" as const },
  { key: "stok_maximum", label: "Maximum Stock", required: false, type: "number" as const },
  {
    key: "shelf_life_days",
    label: "Shelf Life (days)",
    required: false,
    type: "number" as const,
    description: "Leave empty if not applicable (packaging, fuel, etc.)",
  },
  { key: "coa", label: "COA", required: false, description: "PRODUCTION, RND, or ASSET" },
  {
    key: "harga_beli",
    label: "Purchase Price",
    required: false,
    type: "number" as const,
    description: "Price per large unit (IDR)",
  },
  {
    key: "opening_stock",
    label: "Opening Stock",
    required: false,
    type: "number" as const,
    description: "Initial quantity in small/base unit",
  },
  {
    key: "stall_code",
    label: "Stall Code",
    required: false,
    description: "MAIN (default), STALL-01 … STALL-13",
  },
  { key: "deskripsi", label: "Description", required: false },
  { key: "status", label: "Status", required: false, description: "active or inactive" },
];
