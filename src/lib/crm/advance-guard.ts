/**
 * EPIC-050 Fase 2 — gate API pengaturan CRM Advance (scoring/workflow/approval rules):
 * super_admin/admin, atau siapa pun yang di-grant menu crm.settings.* lewat IAM.
 */
import { NextResponse } from "next/server";
import { getApiUser, type ApiUser } from "@/lib/api/auth";
import { getApiUserScope, type UserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";

export async function requireCrmSettingsUser(): Promise<
  { error: NextResponse; user: null; scope: null } | { error: null; user: ApiUser; scope: UserScope | null }
> {
  const user = await getApiUser();
  if (!user) {
    return { error: NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 }), user: null, scope: null };
  }
  if (!(await userHasIamPrefix(user.id, user.role, IAM.crmSettings))) {
    return { error: NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 }), user: null, scope: null };
  }
  const scope = await getApiUserScope();
  return { error: null, user, scope };
}

/** company_id aturan: super_admin tanpa scope → NULL (global); selain itu company user. */
export function ruleCompanyId(user: ApiUser, scope: UserScope | null): string | null {
  if (user.role === "super_admin" && !scope?.companyId) return null;
  return scope?.companyId ?? null;
}

/** Filter baris aturan yang boleh dilihat: global + company user (TRUE bila tanpa scope). */
export function ruleVisibilityWhere(alias: string, scope: UserScope | null, params: unknown[]): string {
  if (!scope?.companyId) return "TRUE";
  params.push(scope.companyId);
  return `(${alias}.company_id IS NULL OR ${alias}.company_id = $${params.length})`;
}
