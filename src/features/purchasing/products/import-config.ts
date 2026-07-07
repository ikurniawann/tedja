export const PRODUCT_IMPORT_CATEGORY_HINT =
  "APPETIZER, MAIN, RICE, NOODLE, SOUP, SIDE, SNACK, DESSERT, COFFEE, TEA, BEVERAGE, JUICE, MOCKTAIL, BAKERY, CAKE, PACKAGE, PROMO, OTHER";

export const PRODUCT_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Code",
    required: false,
    description: "Leave empty to auto-generate PRD-YYYYMMDD-###",
  },
  { key: "nama", label: "Product Name", required: true },
  {
    key: "stall_code",
    label: "Stall Code",
    required: true,
    description: "Must match stall master (e.g. MAIN, STALL-01)",
  },
  {
    key: "kategori",
    label: "Category Code",
    required: false,
    description: PRODUCT_IMPORT_CATEGORY_HINT,
  },
  {
    key: "satuan_kode",
    label: "Unit Code",
    required: true,
    description: "Must match unit master (e.g. PCS, PORTION, PORSI)",
  },
  { key: "deskripsi", label: "Description", required: false },
  {
    key: "harga_jual",
    label: "Selling Price",
    required: false,
    type: "number" as const,
  },
  {
    key: "harga_modal",
    label: "Cost Price",
    required: false,
    type: "number" as const,
  },
  {
    key: "markup_persen",
    label: "Markup %",
    required: false,
    type: "number" as const,
    description: "Default 30 when empty",
  },
  {
    key: "production_output_type",
    label: "Output Type",
    required: false,
    description: "FINISHED_GOOD or WIP",
  },
  {
    key: "status",
    label: "Status",
    required: false,
    description: "active or inactive",
  },
];
