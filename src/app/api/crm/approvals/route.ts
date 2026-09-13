import { NextRequest, NextResponse } from "next/server";
import { getApiUser, successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";

/**
 * EPIC-050 T-2.4 — inbox approval. view=mine (default): yang menunggu keputusan
 * saya (role/user cocok pada tingkat berjalan) + yang saya ajukan; view=all:
 * semua di scope (admin/super_admin). status=pending|approved|rejected|all.
 */
export async function GET(request: NextRequest) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  if (!(await userHasIamPrefix(user.id, user.role, IAM.salesFunnel))) {
    return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
  }
  const scope = await getApiUserScope();
  const url = new URL(request.url);
  const view = url.searchParams.get("view") === "all" && user.role !== "sales" ? "all" : "mine";
  const status = url.searchParams.get("status") ?? "pending";

  const conditions: string[] = ["r.object = 'quotation'"];
  const params: unknown[] = [];
  const add = (fragment: string, value: unknown) => {
    params.push(value);
    conditions.push(fragment.replace("?", `$${params.length}`));
  };
  if (scope?.companyId) add("r.company_id = ?", scope.companyId);
  if (status !== "all") add("r.status = ?", status);
  if (view === "mine") {
    params.push(user.id, user.role);
    conditions.push(
      `(r.requested_by = $${params.length - 1}
        OR EXISTS (SELECT 1 FROM crm.crm_approval_steps s
                    WHERE s.request_id = r.id AND s.level = r.current_level AND s.status = 'pending'
                      AND (s.approver_user_id = $${params.length - 1}
                           OR s.approver_role = $${params.length}
                           OR $${params.length} = 'super_admin')))`
    );
  }
  const rows = await query(
    `SELECT r.id, r.status, r.current_level, r.discount_percent, r.amount, r.note, r.created_at, r.resolved_at,
            r.subject_id AS quotation_id, q.quote_number, q.total, q.subtotal, q.discount_nominal, q.status AS quotation_status,
            d.id AS deal_id, d.title AS deal_title, l.org_name, l.pic_name,
            u.full_name AS requested_by_name,
            (SELECT json_agg(json_build_object('level', s.level, 'status', s.status, 'approver_role', s.approver_role,
                                               'approver_user_id', s.approver_user_id, 'decided_at', s.decided_at,
                                               'comment', s.comment, 'decided_by_name', du.full_name) ORDER BY s.level)
               FROM crm.crm_approval_steps s LEFT JOIN configuration.users du ON du.id = s.decided_by
              WHERE s.request_id = r.id) AS steps,
            EXISTS (SELECT 1 FROM crm.crm_approval_steps s
                     WHERE s.request_id = r.id AND s.level = r.current_level AND s.status = 'pending'
                       AND (s.approver_user_id = $${params.length + 1} OR s.approver_role = $${params.length + 2} OR $${params.length + 2} = 'super_admin')) AS can_decide
     FROM crm.crm_approval_requests r
     JOIN crm.crm_sales_quotations q ON q.id = r.subject_id
     JOIN crm.crm_sales_deals d ON d.id = q.deal_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     LEFT JOIN configuration.users u ON u.id = r.requested_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC
     LIMIT 200`,
    [...params, user.id, user.role]
  );
  return successResponse(rows);
}
