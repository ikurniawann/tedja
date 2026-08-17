import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";
import type { UserRole } from "@/types";

/** @deprecated Gate memakai menu IAM accounting / sales-funnel. */
export const FINANCE_ROLES: UserRole[] = ["super_admin", "finance_staff"];

/** @deprecated Dipakai call site lama; viewer = accounting.receivable ATAU sales-funnel. */
export const INVOICE_VIEWER_ROLES: UserRole[] = [
  "super_admin",
  "sales",
  "finance_staff",
];

export type FinanceUser = { id: string; role: UserRole };

function financeMenus(allowed: readonly string[]): readonly string[] {
  if (allowed.includes("sales")) {
    return [...IAM.accounting, ...IAM.salesFunnel];
  }
  return IAM.accounting;
}

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
  if (!(await userHasIamPrefix(user.id, user.role, financeMenus(allowed)))) {
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
