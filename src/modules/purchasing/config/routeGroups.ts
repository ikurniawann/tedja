import { RouteGroup } from "./index";

/**
 * Purchasing module route definitions.
 * Each route maps a URL path to a page component.
 *
 * Convention:
 *   path: URL segment (kebab-case)
 *   page: relative path to page file under ../pages/
 *   label: sidebar display name (Indonesian)
 *   icon: heroicons outline class (without "h-5 w-5" — shared by NavSidebar)
 */
export const PURCHASING_ROUTES: RouteGroup = {
  groupKey: "purchasing",
  groupLabel: "Purchasing",
  icon: "ShoppingCartIcon", // Maps to heroicons outline
  basePath: "/dashboard/purchasing",
  routes: [
    // ── Suppliers ──────────────────────────────────────────
    {
      path: "suppliers",
      label: "Supplier",
      children: [
        { path: "suppliers/insert", label: "Tambah Supplier" },
        { path: "suppliers/[id]", label: "Detail Supplier" },
        { path: "suppliers/edit/[id]", label: "Edit Supplier" },
      ],
    },

    // ── Raw Materials ──────────────────────────────────────
    {
      path: "raw-materials",
      label: "Bahan Baku",
      children: [
        { path: "raw-materials/insert", label: "Tambah Bahan" },
        { path: "raw-materials/[id]", label: "Detail Bahan" },
        { path: "raw-materials/edit/[id]", label: "Edit Bahan" },
      ],
    },

    // ── Products ────────────────────────────────────────────
    {
      path: "products",
      label: "Produk",
      children: [
        { path: "products/insert", label: "Tambah Produk" },
        { path: "products/[id]", label: "Detail Produk" },
        { path: "products/edit/[id]", label: "Edit Produk" },
        { path: "products/bom/[id]", label: "BOM Editor" },
      ],
    },

    // ── Purchase Orders ──────────────────────────────────────
    {
      path: "purchase-orders",
      label: "Purchase Order",
      badge: "open",
      children: [
        { path: "purchase-orders/insert", label: "Buat PO" },
        { path: "purchase-orders/[id]", label: "Detail PO" },
        { path: "purchase-orders/edit/[id]", label: "Edit PO" },
        { path: "purchase-orders/approval", label: "Approval PO" },
      ],
    },

    // ── Receiving ───────────────────────────────────────────
    {
      path: "grn",
      label: "Goods Receipt",
      badge: "pending_grn",
      children: [
        { path: "grn/insert", label: "Record Goods Receipt" },
        { path: "grn/[id]", label: "Goods Receipt Detail" },
        { path: "delivery/[id]", label: "Delivery Detail" },
      ],
    },

    // ── QC ──────────────────────────────────────────────────
    {
      path: "qc",
      label: "Quality Control",
      badge: "pending_qc",
      children: [
        { path: "qc/[id]", label: "Detail QC" },
      ],
    },

    // ── Returns ─────────────────────────────────────────────
    {
      path: "returns",
      label: "Retur",
      badge: null,
      children: [
        { path: "returns/insert", label: "Buat Retur" },
        { path: "returns/[id]", label: "Detail Retur" },
      ],
    },

    // ── Inventory ────────────────────────────────────────────
    {
      path: "inventory",
      label: "Inventori",
      badge: "low_stock",
      children: [
        { path: "inventory/adjustment", label: "Koreksi Stok" },
        { path: "inventory/[id]/movements", label: "Mutasi Stok" },
      ],
    },

    // ── Reports ──────────────────────────────────────────────
    {
      path: "reports",
      label: "Reports",
      icon: "DocumentChartBarIcon",
      badge: null,
      children: [
        { path: "reports/stock-card", label: "Stock Card" },
        { path: "reports/inventory-valuation", label: "Inventory Valuation" },
        { path: "reports/po-summary", label: "PO Summary" },
        { path: "reports/po-detail", label: "PO Detail" },
        { path: "reports/supplier-performance", label: "Supplier Performance" },
        { path: "reports/hpp-breakdown", label: "HPP Produk" },
      ],
    },
  ],
};
