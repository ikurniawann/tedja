// EPIC-032 — guard & konteks route promo. Pengelola = super_admin +
// marketing (keputusan owner 26 Jul; role marketing di-provision penuh di
// Task A4 — sebelum itu hanya super_admin yang efektif punya akses).

import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import {
  resolveTicketingVenue,
  venueNotConfiguredResponse,
} from "@/lib/ticketing/server";
import type { UserRole } from "@/types";

export const PROMO_MANAGER_ROLES: UserRole[] = ["super_admin", "marketing"];

export type PromoContext = {
  user: { id: string; role: UserRole };
  companyId: string;
  branchId: string;
};

/**
 * Guard + resolusi venue utk route promo (pola requireTicketingContext —
 * resolver venue di-reuse karena promo ber-scope venue yang sama).
 */
export async function requirePromoContext(
  roles: UserRole[] = PROMO_MANAGER_ROLES
): Promise<
  { error: NextResponse; ctx: null } | { error: null; ctx: PromoContext }
> {
  const user = await getApiUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      ),
      ctx: null,
    };
  }
  if (!roles.includes(user.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      ),
      ctx: null,
    };
  }
  const scope = await getApiUserScope();
  const { companyId, branchId } = await resolveTicketingVenue(scope);
  if (!companyId || !branchId) {
    return { error: venueNotConfiguredResponse(), ctx: null };
  }
  return {
    error: null,
    ctx: { user: { id: user.id, role: user.role }, companyId, branchId },
  };
}

// Charset anti-ambigu (tanpa 0/O/1/I) — pola booking code EPIC-023
const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Satu kode acak `PREFIX-XXXXXX` utk batch voucher. */
export function generateVoucherCode(prefix: string): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += CODE_CHARSET[Math.floor(Math.random() * CODE_CHARSET.length)];
  }
  return `${prefix}-${suffix}`;
}
