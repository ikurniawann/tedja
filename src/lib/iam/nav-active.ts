/**
 * Sidebar active-state helper.
 * Prevents generic paths (e.g. /dashboard/settings) from staying active
 * when a sibling has a more specific match (e.g. /dashboard/settings/users).
 */
import {
  NAV_FROM_APPROVAL_PO,
  NAV_FROM_APPROVAL_PR,
  getApprovalPoMenuHref,
  getApprovalPrMenuHref,
  getPurchaseOrderListMenuHref,
  getPurchaseRequestListMenuHref,
  isPurchaseOrderDetailPath,
  isPurchaseRequestDetailPath,
  menuHrefsMatch,
  normalizeMenuHref,
  normalizePurchasingPathname,
} from "./nav-context";

export function isNavLinkActive(
  pathname: string,
  href: string,
  peerHrefs: string[] = [],
  navFrom?: string | null
): boolean {
  const normalizedPath = normalizePurchasingPathname(pathname);
  const normalizedHref = normalizeMenuHref(href);

  if (navFrom === NAV_FROM_APPROVAL_PR && isPurchaseRequestDetailPath(normalizedPath)) {
    const approvalHref = getApprovalPrMenuHref(normalizedPath);
    const purchaseRequestHref = getPurchaseRequestListMenuHref(normalizedPath);

    if (approvalHref && menuHrefsMatch(href, approvalHref)) return true;
    if (purchaseRequestHref && menuHrefsMatch(href, purchaseRequestHref)) return false;
  }

  if (navFrom === NAV_FROM_APPROVAL_PO && isPurchaseOrderDetailPath(normalizedPath)) {
    const approvalHref = getApprovalPoMenuHref(normalizedPath);
    const purchaseOrderHref = getPurchaseOrderListMenuHref(normalizedPath);

    if (approvalHref && menuHrefsMatch(href, approvalHref)) return true;
    if (purchaseOrderHref && menuHrefsMatch(href, purchaseOrderHref)) return false;
  }

  if (normalizedPath === normalizedHref) return true;

  if (!normalizedPath.startsWith(`${normalizedHref}/`)) return false;

  const blockedByPeer = peerHrefs.some((peer) => {
    const normalizedPeer = normalizeMenuHref(peer);
    if (normalizedPeer === normalizedHref || normalizedPeer.length <= normalizedHref.length) {
      return false;
    }
    if (!normalizedPeer.startsWith(`${normalizedHref}/`)) return false;
    return normalizedPath === normalizedPeer || normalizedPath.startsWith(`${normalizedPeer}/`);
  });

  return !blockedByPeer;
}

/** Known duplicate route_path prefixes in IAM seed (informational). */
export const DUPLICATE_ROUTE_GROUPS = [
  {
    prefix: "/dashboard/settings",
    items: ["user-management (group)", "user-management.menus", "user-management.roles"],
  },
  {
    prefix: "/dashboard/settings/business",
    items: ["business (group)", "business.hierarchy"],
  },
  {
    prefix: "/dashboard/master",
    items: [
      "user-management.master (group)",
      "user-management.master.departments",
      "user-management.master.positions",
      "user-management.master.employment-statuses",
    ],
  },
  {
    prefix: "/dashboard/employees",
    items: ["hris.employees (group)", "hris.employees.all"],
  },
  {
    prefix: "/dashboard/purchasing/grn",
    items: ["purchasing.grn.group", "purchasing.grn"],
  },
  {
    prefix: "/dashboard/purchasing/suppliers",
    items: ["purchasing.suppliers.group", "purchasing.suppliers"],
  },
  {
    prefix: "/dashboard/inventory",
    items: ["inventory (group)", "inventory.dashboard"],
  },
  {
    prefix: "/dashboard/pos",
    items: ["pos (group)", "pos.reports.dashboard"],
  },
  {
    prefix: "/dashboard/crm",
    items: ["crm (group)", "crm.overview.dashboard"],
  },
] as const;
