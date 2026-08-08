import {
  ITEMS_LANDING_PATH,
  ITEMS_PRODUCT_CATEGORIES_PATH,
  ITEMS_PRODUCTS_PATH,
  ITEMS_RAW_MATERIALS_PATH,
  PRODUCT_ROUTES,
  RM_ROUTES,
} from "./item-routes";

export {
  ITEMS_LANDING_PATH,
  ITEMS_PRODUCT_CATEGORIES_PATH,
  ITEMS_PRODUCTS_PATH,
  ITEMS_RAW_MATERIALS_PATH,
  PRODUCT_BASE,
  PRODUCT_ROUTES,
  RM_BASE,
  RM_ROUTES,
} from "./item-routes";

/** @deprecated Use ITEMS_LANDING_PATH */
export const PURCHASING_ITEMS_LANDING = ITEMS_LANDING_PATH;

export const ITEMS_BREADCRUMB = {
  label: "Items",
  href: ITEMS_LANDING_PATH,
} as const;

/** @deprecated Use ITEMS_BREADCRUMB */
export const PURCHASING_ITEMS_BREADCRUMB = ITEMS_BREADCRUMB;

export const RAW_MATERIAL_BREADCRUMB = {
  label: "Bahan Baku",
  href: ITEMS_RAW_MATERIALS_PATH,
} as const;

export const PRODUCT_BREADCRUMB = {
  label: "Product",
  href: ITEMS_PRODUCTS_PATH,
} as const;

export interface ItemsNavLink {
  href: string;
  label: string;
}

export interface ItemsNavGroup {
  label: string;
  items: readonly ItemsNavLink[];
}

export const RAW_MATERIAL_NAV_GROUPS: readonly ItemsNavGroup[] = [
  {
    label: "Data Master",
    items: [
      { href: RM_ROUTES.units, label: "Satuan" },
      { href: RM_ROUTES.categories, label: "Kategori" },
      { href: RM_ROUTES.materials, label: "Bahan Baku" },
    ],
  },
  {
    label: "Persediaan",
    items: [
      { href: RM_ROUTES.inventoryStock, label: "Stok" },
      { href: RM_ROUTES.inventoryOpname, label: "Stok Opname" },
      { href: RM_ROUTES.inventoryAdjustment, label: "Penyesuaian Stok" },
      { href: RM_ROUTES.inventoryTransfer, label: "Transfer Stok" },
    ],
  },
  {
    label: "Pembelian",
    items: [
      { href: RM_ROUTES.purchasingSuppliers, label: "Supplier" },
      { href: RM_ROUTES.purchasingPr, label: "Purchase Request" },
      { href: RM_ROUTES.purchasingPo, label: "Purchase Order" },
      { href: RM_ROUTES.purchasingDelivery, label: "Lacak Pengiriman" },
      { href: RM_ROUTES.purchasingGrn, label: "Penerimaan (GRN)" },
      { href: RM_ROUTES.purchasingReturns, label: "Retur" },
    ],
  },
  {
    label: "Approval",
    items: [
      { href: RM_ROUTES.approvalPr, label: "Approval PR" },
      { href: RM_ROUTES.approvalPo, label: "Approval PO" },
    ],
  },
  {
    label: "Production",
    items: [
      { href: RM_ROUTES.productionRecipes, label: "Bill of Materials" },
      { href: RM_ROUTES.productionHub, label: "Production In-House" },
    ],
  },
] as const;

export const PRODUCT_NAV_GROUPS: readonly ItemsNavGroup[] = [
  {
    label: "Master Data",
    items: [
      { href: PRODUCT_ROUTES.units, label: "Unit" },
      { href: PRODUCT_ROUTES.categories, label: "Category" },
      { href: PRODUCT_ROUTES.products, label: "Product" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: PRODUCT_ROUTES.inventoryStock, label: "Stock" },
      { href: PRODUCT_ROUTES.inventoryOpname, label: "Stock Opname" },
      { href: PRODUCT_ROUTES.inventoryAdjustment, label: "Stock Adjustment" },
      { href: PRODUCT_ROUTES.inventoryTransfer, label: "Stock Transfer" },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { href: PRODUCT_ROUTES.purchasingVendor, label: "Vendor" },
      { href: PRODUCT_ROUTES.purchasingPriceList, label: "Price List" },
      { href: PRODUCT_ROUTES.purchasingPr, label: "Purchase Request" },
      { href: PRODUCT_ROUTES.purchasingPo, label: "Purchase Order" },
      { href: PRODUCT_ROUTES.purchasingDelivery, label: "Track Shipment" },
      { href: PRODUCT_ROUTES.purchasingReceive, label: "GRN" },
      { href: PRODUCT_ROUTES.purchasingReturns, label: "Return" },
      { href: PRODUCT_ROUTES.purchasingInvoice, label: "Invoice" },
    ],
  },
  {
    label: "Approval",
    items: [
      { href: PRODUCT_ROUTES.approvalPr, label: "Approval PR" },
      { href: PRODUCT_ROUTES.approvalPo, label: "Approval PO" },
    ],
  },
  {
    label: "Production",
    items: [
      { href: PRODUCT_ROUTES.productionRecipes, label: "Bill of Materials" },
      { href: PRODUCT_ROUTES.productionHub, label: "Production In-House" },
    ],
  },
] as const;

/** @deprecated Use PRODUCT_NAV_GROUPS */
export const PRODUCT_NAV_GROUP: ItemsNavGroup = {
  label: "Product",
  items: PRODUCT_NAV_GROUPS.flatMap((g) => [...g.items]),
};

export const ITEMS_NAV_GROUPS = [
  {
    label: "Bahan Baku",
    items: RAW_MATERIAL_NAV_GROUPS.flatMap((g) => [...g.items]),
  },
  {
    label: "Product",
    items: PRODUCT_NAV_GROUPS.flatMap((g) => [...g.items]),
  },
  {
    label: "Reports",
    items: [
      { href: "/dashboard/purchasing/reports/stock-card", label: "Stock Card" },
      { href: "/dashboard/purchasing/reports/inventory-valuation", label: "Inventory Valuation" },
      { href: "/dashboard/purchasing/reports/po-summary", label: "PO Summary" },
      { href: "/dashboard/purchasing/reports/po-detail", label: "PO Detail" },
      { href: "/dashboard/purchasing/reports/supplier-performance", label: "Supplier Performance" },
      { href: "/dashboard/purchasing/reports/production-in-house", label: "Production In-House" },
    ],
  },
] as const;

export const ITEMS_ACTIVE_PATHS = [
  ITEMS_LANDING_PATH,
  "/dashboard/purchasing/items",
  "/dashboard/purchasing/reports",
  ...RAW_MATERIAL_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
  ...PRODUCT_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
] as const;
