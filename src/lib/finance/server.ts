import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import type { UserRole } from "@/types";

// Modul Finance (EPIC-025) — keputusan owner 2026-07-23 Opsi B:
// invoice diterbitkan & pembayaran dicatat oleh finance, bukan sales.
export const FINANCE_ROLES: UserRole[] = ["super_admin", "finance_staff"];

/** Aktor yang boleh MELIHAT invoice deal: sales (mengajukan) + finance. */
export const INVOICE_VIEWER_ROLES: UserRole[] = [
  "super_admin",
  "sales",
  "finance_staff",
];

export type FinanceUser = { id: string; role: UserRole };

/**
 * Guard role generik modul Finance — pola requireSalesFunnelRole.
 * Default FINANCE_ROLES; endpoint yang dibagi dengan sales (list/ajukan/PDF)
 * memakai INVOICE_VIEWER_ROLES.
 */
export async function requireFinanceRole(
  allowed: UserRole[] = FINANCE_ROLES
): Promise<
  { error: NextResponse; user: null } | { error: null; user: FinanceUser }
> {
  const user = await getApiUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      ),
      user: null,
    };
  }
  if (!allowed.includes(user.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      ),
      user: null,
    };
  }
  return { error: null, user: { id: user.id, role: user.role } };
}

export function isFinanceRole(role: UserRole): boolean {
  return FINANCE_ROLES.includes(role);
}
