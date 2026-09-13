import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser, ruleCompanyId, ruleVisibilityWhere } from "@/lib/crm/advance-guard";
import { approvalRuleSchema } from "@/lib/crm/approvals";

/** EPIC-050 T-2.4 — aturan approval diskon quotation. */
export async function GET() {
  const { error, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const params: unknown[] = [];
  const where = ruleVisibilityWhere("r", scope, params);
  const rows = await query(
    `SELECT r.id, r.company_id, r.object, r.name, r.level, r.min_discount_percent, r.approver_role,
            r.approver_user_id, u.full_name AS approver_name, r.is_active, r.created_at
     FROM crm.crm_approval_rules r LEFT JOIN configuration.users u ON u.id = r.approver_user_id
     WHERE ${where} ORDER BY r.level, r.min_discount_percent`,
    params
  );
  return successResponse(rows);
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const parsed = approvalRuleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const row = await queryOne(
    `INSERT INTO crm.crm_approval_rules (company_id, name, level, min_discount_percent, approver_role, approver_user_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, level, min_discount_percent`,
    [ruleCompanyId(user, scope), b.name, b.level, b.min_discount_percent, b.approver_role || null, b.approver_user_id || null, b.is_active]
  );
  return createdResponse(row, "Aturan approval dibuat");
}
