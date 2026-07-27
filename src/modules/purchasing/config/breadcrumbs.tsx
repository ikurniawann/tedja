// ============================================================
// Purchasing Breadcrumb Configuration
//
// Dynamically resolved from the current pathname.
// Usage:
//   import { getBreadcrumbs } from "@/modules/purchasing/config/breadcrumbs";
//   const crumbs = getBreadcrumbs(pathname);
// ============================================================

import { RouteDef, ROUTE_MAP } from "./routes";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Parse a Next.js path with [param] segments.
 * e.g. "/dashboard/purchasing/suppliers/[id]" → segments ["dashboard","purchasing","suppliers","[id]"]
 */
function pathToSegments(path: string): string[] {
  return path.replace(/\/$/, "").split("/").filter(Boolean);
}

/**
 * Match a pathname against route definitions.
 * Returns the matched RouteDef or null.
 *
 * Handles [param] wildcards by comparing segment count.
 */
function matchRoute(pathname: string): RouteDef | null {
  const clean = pathname.replace(/\/$/, "");
  // Direct match
  if (ROUTE_MAP[pathname as keyof typeof ROUTE_MAP]) {
    return ROUTE_MAP[pathname as keyof typeof ROUTE_MAP];
  }

  // Try removing trailing segments for parent routes
  const segments = pathToSegments(clean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const match = Object.values(ROUTE_MAP).find((r) => {
      const rSegs = pathToSegments(r.path);
      return (
        rSegs.length === segments.length &&
        r.path.replace(/\/$/, "") === clean
      );
    });
    if (match) return match;
  }
  return null;
}

// Route → breadcrumb parents (before the current page)
const BREADCRUMB_TREE: Record<string, { parent?: string; labelOverride?: string }> = {
  // Suppliers
  "suppliers.list": {},
  "suppliers.new": { parent: "suppliers.list" },
  "suppliers.detail": { parent: "suppliers.list" },
  "suppliers.edit": { parent: "suppliers.detail" },

  // Raw Materials
  "raw-materials.list": {},
  "raw-materials.new": { parent: "raw-materials.list" },
  "raw-materials.detail": { parent: "raw-materials.list" },
  "raw-materials.edit": { parent: "raw-materials.detail" },

  // Products
  "products.list": {},
  "products.new": { parent: "products.list" },
  "products.detail": { parent: "products.list" },
  "products.edit": { parent: "products.detail" },
  "products.bom": { parent: "products.detail" },

  // Purchase Orders
  "purchase-orders.list": {},
  "purchase-orders.new": { parent: "purchase-orders.list" },
  "purchase-orders.detail": { parent: "purchase-orders.list" },
  "purchase-orders.edit": { parent: "purchase-orders.detail" },
  "purchase-orders.approval": { parent: "purchase-orders.list" },

  // Delivery
  "delivery.list": {},
  "delivery.detail": { parent: "delivery.list" },

  // Receiving
  "receiving.list": {},
  "receiving.grn-new": { parent: "receiving.list" },
  "receiving.grn-detail": { parent: "receiving.list" },

  // QC
  "qc.list": {},
  "qc.detail": { parent: "qc.list" },

  // Returns
  "returns.list": {},
  "returns.new": { parent: "returns.list" },
  "returns.detail": { parent: "returns.list" },

  // Inventory
  "inventory.list": {},
  "inventory.movements": { parent: "inventory.list" },
  "inventory.adjustment": { parent: "inventory.list" },

  // Reports
  "reports.stock-card": { labelOverride: "Stock Card" },
  "reports.inventory-valuation": { labelOverride: "Inventory Valuation" },
  "reports.po-summary": { labelOverride: "PO Summary" },
  "reports.po-detail": { labelOverride: "PO Detail" },
  "reports.supplier-performance": { labelOverride: "Supplier Performance" },
  "reports.production-in-house": { labelOverride: "Production In-House" },
  "reports.hpp-breakdown": { labelOverride: "HPP Produk" },
};

function getBreadcrumbChain(routeKey: string): BreadcrumbItem[] {
  const chain: BreadcrumbItem[] = [];

  // Always start with Home → Purchasing
  chain.push({ label: "Home", href: "/dashboard" });
  chain.push({ label: "Purchasing", href: "/dashboard/purchasing" });

  const entry = BREADCRUMB_TREE[routeKey];
  if (!entry) return chain;

  if (entry.parent) {
    const parentDef = ROUTE_MAP[entry.parent as keyof typeof ROUTE_MAP];
    if (parentDef) {
      chain.push({ label: parentDef.meta.label, href: parentDef.path });
    }
  }

  // Add current page
  const currentDef = ROUTE_MAP[routeKey as keyof typeof ROUTE_MAP];
  if (currentDef) {
    chain.push({
      label: entry.labelOverride ?? currentDef.meta.label,
      href: undefined, // last item — no link
    });
  }

  return chain;
}

/**
 * Main export — call with `usePathname()` in a client component.
 */
export function getBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const match = matchRoute(pathname);
  if (!match) {
    // Fallback: return basic chain
    return [
      { label: "Home", href: "/dashboard" },
      { label: "Purchasing", href: "/dashboard/purchasing" },
      { label: pathname.split("/").pop() ?? "" },
    ];
  }
  return getBreadcrumbChain(match.route);
}

/**
 * Breadcrumb nav component — drop into any page layout.
 * Usage: <Breadcrumb pathname={pathname} />
 */
export function BreadcrumbNav({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-sm text-gray-500 mb-4">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="mx-1 text-gray-300">/</span>}
          {item.href ? (
            <a
              href={item.href}
              className="hover:text-gray-900 transition-colors"
            >
              {item.label}
            </a>
          ) : (
            <span className="text-gray-900 font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
