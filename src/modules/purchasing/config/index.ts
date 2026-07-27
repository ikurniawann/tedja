import { NextRequest, NextResponse } from "next/server";

export interface RouteItem {
  path: string;
  page: string;
  label: string;
  badge?: string | null;
  icon?: string;
  children?: RouteItem[];
}

export interface RouteGroup {
  groupKey: string;
  groupLabel: string;
  icon?: string;
  basePath: string;
  routes: RouteItem[];
  requiredRoles?: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Flatten all routes including nested children into a single list. */
export function flattenRoutes(groups: RouteGroup[]): RouteItem[] {
  const result: RouteItem[] = [];
  function walk(items: RouteItem[]) {
    for (const item of items) {
      result.push(item);
      if (item.children) walk(item.children);
    }
  }
  for (const group of groups) {
    walk(group.routes);
  }
  return result;
}

/** Build the Next.js URL from a route item (app router: /[groupKey]/[path]). */
export function buildUrl(group: RouteGroup, item: RouteItem): string {
  return `${group.basePath}/${item.path}`;
}

/** Find a route item by its URL path across all groups. */
export function findRouteByPath(groups: RouteGroup[], pathname: string): { group: RouteGroup; item: RouteItem } | null {
  for (const group of groups) {
    for (const item of flattenRoutes({ routes: group.routes } as RouteGroup)) {
      const fullPath = `${group.basePath}/${item.path}`;
      if (fullPath === pathname || fullPath === pathname.replace(/\/+$/, "")) {
        return { group, item };
      }
    }
  }
  return null;
}

// ─── Role guards ───────────────────────────────────────────────────────────────

export type Role =
  | "super_admin"
  | "purchasing_admin"
  | "purchasing_manager"
  | "purchasing_staff"
  | "warehouse_staff"
  | "qc_staff"
  | "viewer";

/** Role hierarchy — higher index = more privilege */
export const ROLE_HIERARCHY: Role[] = [
  "viewer",
  "warehouse_staff",
  "qc_staff",
  "purchasing_staff",
  "purchasing_manager",
  "purchasing_admin",
  "super_admin",
];

/** Which roles can access each route key */
const ROUTE_ROLE_MAP: Record<string, Role[]> = {
  // Suppliers
  "suppliers": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "suppliers/insert": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "suppliers/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "suppliers/edit/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  // Raw materials
  "raw-materials": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "raw-materials/insert": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "raw-materials/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "raw-materials/edit/[id]": ["purchasing_manager", "purchasing_admin", "super_admin"],
  // Products
  "products": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "products/insert": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "products/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "products/edit/[id]": ["purchasing_manager", "purchasing_admin", "super_admin"],
  "products/bom/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  // Purchase orders
  "purchase-orders": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "purchase-orders/insert": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "purchase-orders/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "purchase-orders/edit/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "purchase-orders/approval": ["purchasing_manager", "purchasing_admin", "super_admin"],
  // Receiving
  "receiving": ["warehouse_staff", "purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "receiving/insert": ["warehouse_staff", "purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "receiving/[id]": ["warehouse_staff", "purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  // QC
  "qc": ["qc_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "qc/[id]": ["qc_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  // Delivery
  "delivery": ["warehouse_staff", "purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "delivery/[id]": ["warehouse_staff", "purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  // Returns
  "returns": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "returns/insert": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "returns/[id]": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  // Inventory
  "inventory": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  "inventory/adjustment": ["purchasing_admin", "super_admin"],
  "inventory/[id]/movements": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
  // Reports
  "reports": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin", "viewer"],
  "reports/stock-card": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin", "warehouse_admin", "viewer"],
  "reports/inventory-valuation": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin", "viewer"],
  "reports/po-summary": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin", "viewer"],
  "reports/po-detail": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin", "viewer"],
  "reports/supplier-performance": ["purchasing_manager", "purchasing_admin", "super_admin", "viewer"],
  "reports/hpp-breakdown": ["purchasing_staff", "purchasing_manager", "purchasing_admin", "super_admin"],
};

/** Check if a role can access a route path */
export function canAccessRoute(userRole: Role, routePath: string): boolean {
  const allowedRoles = ROUTE_ROLE_MAP[routePath];
  if (!allowedRoles) return false;
  return allowedRoles.includes(userRole);
}

/** Check if user role is high enough (at or above minRole in hierarchy) */
export function hasMinimumRole(userRole: Role, minRole: Role): boolean {
  const userIdx = ROLE_HIERARCHY.indexOf(userRole);
  const minIdx = ROLE_HIERARCHY.indexOf(minRole);
  return userIdx >= minIdx;
}

// ─── Next.js Route Handler (optional — for middleware-style guard) ───────────

export function middlewareGuard(request: NextRequest, userRole: Role): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  // Strip /dashboard/ prefix to get route key
  const match = pathname.match(/^\/dashboard\/purchasing\/(.+)$/);
  if (!match) return null; // Not a purchasing route

  const routePath = match[1];
  if (!canAccessRoute(userRole, routePath)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

// ─── Breadcrumb helpers ────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/** Build breadcrumb trail from a pathname */
export function buildBreadcrumbs(
  groups: RouteGroup[],
  pathname: string
): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [
    { label: "Dashboard", href: "/dashboard" },
  ];

  const match = findRouteByPath(groups, pathname);
  if (!match) return crumbs;

  const { group, item } = match;
  crumbs.push({ label: group.groupLabel, href: `${group.basePath}` });

  // For nested routes, find the parent
  if (item.path.includes("/")) {
    const parentPath = item.path.split("/")[0];
    const parent = group.routes.find((r) => r.path === parentPath);
    if (parent) {
      crumbs.push({ label: parent.label, href: buildUrl(group, parent) });
    }
  }

  crumbs.push({ label: item.label });
  return crumbs;
}

// ─── Export groups ─────────────────────────────────────────────────────────────

export { PURCHASING_ROUTES } from "./routeGroups";
