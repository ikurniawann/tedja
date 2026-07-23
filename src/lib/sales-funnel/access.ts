import { getApiUserScope } from "@/lib/api/scope";
import { queryOne } from "@/lib/db";
import { requireCompanyScope, type SalesFunnelUser } from "./server";

export type AccessibleLead = {
  id: string;
  company_id: string;
  branch_id: string;
  owner_user_id: string | null;
};

export type AccessibleDeal = AccessibleLead & {
  lead_id: string;
  stage_id: string;
  event_date: string | null;
  value_final: string | null;
};

type AccessResult<T> = { record: T | null; forbidden: boolean };

/**
 * Cek scope bisnis + kepemilikan sales atas satu baris lead/deal — pola
 * findAccessibleLead Fase A yang dipakai bersama semua route (leads, deals,
 * activities, kirim WA). Fail-closed: non-super_admin tanpa company scope
 * langsung forbidden.
 */
async function checkRowAccess<T extends AccessibleLead>(
  row: T | null,
  user: SalesFunnelUser
): Promise<AccessResult<T>> {
  const scope = await getApiUserScope();
  if (requireCompanyScope(user, scope)) {
    return { record: null, forbidden: true };
  }
  if (!row) return { record: null, forbidden: false };

  if (scope?.companyId && row.company_id !== scope.companyId) {
    return { record: null, forbidden: true };
  }
  if (
    scope?.businessScope === "branch" &&
    scope.branchId &&
    row.branch_id !== scope.branchId
  ) {
    return { record: null, forbidden: true };
  }
  if (
    user.role === "sales" &&
    row.owner_user_id !== null &&
    row.owner_user_id !== user.id
  ) {
    return { record: null, forbidden: true };
  }
  return { record: row, forbidden: false };
}

export async function findAccessibleLead(
  id: string,
  user: SalesFunnelUser
): Promise<{ lead: AccessibleLead | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleLead>(
    `SELECT id, company_id, branch_id, owner_user_id
     FROM crm.crm_sales_leads WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { lead: record, forbidden };
}

export async function findAccessibleDeal(
  id: string,
  user: SalesFunnelUser
): Promise<{ deal: AccessibleDeal | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleDeal>(
    `SELECT id, company_id, branch_id, owner_user_id, lead_id, stage_id,
            event_date, value_final
     FROM crm.crm_sales_deals WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { deal: record, forbidden };
}

export async function findAccessibleActivity(
  id: string,
  user: SalesFunnelUser
): Promise<{ activity: AccessibleLead | null; forbidden: boolean }> {
  const row = await queryOne<AccessibleLead>(
    `SELECT id, company_id, branch_id, owner_user_id
     FROM crm.crm_sales_activities WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const { record, forbidden } = await checkRowAccess(row, user);
  return { activity: record, forbidden };
}
