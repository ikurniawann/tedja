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
  label: "Raw Material",
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
    label: "Master Data",
    items: [
      { href: RM_ROUTES.units, label: "Unit" },
      { href: RM_ROUTES.categories, label: "Category" },
      { href: RM_ROUTES.storage, label: "Condition Storage" },
      { href: RM_ROUTES.materials, label: "Raw Material" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: RM_ROUTES.inventoryStock, label: "Stock" },
      { href: RM_ROUTES.inventoryOpname, label: "Stock Opname" },
      { href: RM_ROUTES.inventoryAdjustment, label: "Stock Adjustment" },
      { href: RM_ROUTES.inventoryTransfer, label: "Stock Transfer" },
    ],
  },
  {
    label: "Purchasing",
    items: [
      { href: RM_ROUTES.purchasingSuppliers, label: "Supplier" },
      { href: RM_ROUTES.purchasingPriceList, label: "Price List" },
      { href: RM_ROUTES.purchasingPr, label: "Purchase Request" },
      { href: RM_ROUTES.purchasingPo, label: "Purchase Order" },
      { href: RM_ROUTES.purchasingDelivery, label: "Track Shipment" },
      { href: RM_ROUTES.purchasingGrn, label: "Receive" },
      { href: RM_ROUTES.purchasingReturns, label: "Return" },
      { href: RM_ROUTES.purchasingInvoice, label: "Invoice" },
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
      { href: PRODUCT_ROUTES.purchasingReceive, label: "Receive" },
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
    label: "Raw Material",
    items: RAW_MATERIAL_NAV_GROUPS.flatMap((g) => [...g.items]),
  },
  {
    label: "Product",
    items: PRODUCT_NAV_GROUPS.flatMap((g) => [...g.items]),
  },
] as const;

export const ITEMS_ACTIVE_PATHS = [
  ITEMS_LANDING_PATH,
  "/dashboard/purchasing/items",
  ...RAW_MATERIAL_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
  ...PRODUCT_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)),
] as const;
