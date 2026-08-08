/** Master category codes — must exist in raw material categories (see items-raw-material-categories seeder). */
export const RAW_MATERIAL_IMPORT_CATEGORY_HINT =
  "SAYUR, DAGING, SEAFOOD, DAIRY, BUMBU, KERING, MINUMAN, SAUS, BAKERY, BEKU, OIL, PROTEIN, KEMASAN, NONPANG, BAKAR, LAIN";

export const RAW_MATERIAL_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Kode",
    required: false,
    description: "Kosongkan untuk dibuat otomatis BHN-YYYY-####",
  },
  { key: "nama", label: "Nama", required: true },
  {
    key: "kategori",
    label: "Kode Kategori",
    required: true,
    description: RAW_MATERIAL_IMPORT_CATEGORY_HINT,
  },
  {
    key: "satuan_besar_kode",
    label: "Kode Satuan Besar",
    required: true,
    description: "Harus sesuai master satuan (mis. KG, SACK, DOS, TRAY)",
  },
  {
    key: "satuan_kecil_kode",
    label: "Kode Satuan Kecil",
    required: false,
    description: "Satuan dasar/stok (mis. GR, ML, PCS). Kosongkan jika sama dengan satuan besar.",
  },
  {
    key: "konversi_factor",
    label: "Faktor Konversi",
    required: false,
    type: "number" as const,
    description: "Jumlah satuan kecil per 1 satuan besar (mis. 1 SACK = 25 KG → 25)",
  },
  { key: "stok_minimum", label: "Stok Minimum", required: false, type: "number" as const },
  { key: "stok_maximum", label: "Stok Maksimum", required: false, type: "number" as const },
  {
    key: "shelf_life_days",
    label: "Masa Simpan (hari)",
    required: false,
    type: "number" as const,
    description: "Kosongkan jika tidak berlaku (kemasan, bahan bakar, dll.)",
  },
  { key: "coa", label: "COA", required: false, description: "PRODUCTION, RND, atau ASSET" },
  {
    key: "harga_beli",
    label: "Harga Beli",
    required: false,
    type: "number" as const,
    description: "Harga per satuan besar (IDR)",
  },
  {
    key: "opening_stock",
    label: "Stok Awal",
    required: false,
    type: "number" as const,
    description: "Jumlah awal dalam satuan kecil/dasar",
  },
  {
    key: "stall_code",
    label: "Kode Outlet",
    required: false,
    description: "WH-01 (Gudang Utama), STALL-02 … STALL-14",
  },
  { key: "deskripsi", label: "Deskripsi", required: false },
  { key: "status", label: "Status", required: false, description: "active atau inactive" },
];
