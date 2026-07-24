import type { UserRole } from "@/types";

/** Roles that can operate the full purchasing transactional flow (PR/PO → GRN → invoice). */
export const PURCHASING_OPS_ROLES = [
  "admin",
  "super_admin",
  "purchasing_admin",
  "purchasing_manager",
  "purchasing_staff",
] as const satisfies readonly UserRole[];

/** Approve / cancel PO (and similar elevated actions). */
export const PURCHASING_APPROVE_ROLES = [
  "admin",
  "super_admin",
  "purchasing_admin",
  "purchasing_manager",
] as const satisfies readonly UserRole[];

/** Record vendor payments / purchase invoices. */
export const PURCHASING_PAYMENT_ROLES = [
  "admin",
  "super_admin",
  "purchasing_admin",
  "finance_staff",
] as const satisfies readonly UserRole[];

export function withAdminRole<T extends string>(roles: readonly T[]): Array<T | "admin"> {
  if ((roles as readonly string[]).includes("admin")) return [...roles];
  return ["admin", ...roles];
}
