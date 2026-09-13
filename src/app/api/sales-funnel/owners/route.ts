import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/** Daftar user yang bisa jadi penanggung jawab/approver (sales, admin, super_admin) di scope. */
export async function GET() {
  const { error } = await requireSalesFunnelRole();
  if (error) return error;
  const scope = await getApiUserScope();
  const rows = await query(
    `SELECT id, full_name, role, company_id FROM configuration.users
     WHERE status = 'active' AND role IN ('sales', 'admin', 'super_admin', 'marketing', 'hrd')
       AND ($1::uuid IS NULL OR company_id IS NULL OR company_id = $1)
     ORDER BY role, full_name LIMIT 200`,
    [scope?.companyId ?? null]
  );
  return successResponse(rows);
}
