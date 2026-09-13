import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser, ruleCompanyId, ruleVisibilityWhere } from "@/lib/crm/advance-guard";
import { scoringRuleSchema } from "@/lib/crm/scoring";

/** EPIC-050 T-2.2 — aturan lead scoring. */
export async function GET() {
  const { error, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const params: unknown[] = [];
  const where = ruleVisibilityWhere("r", scope, params);
  const rows = await query(
    `SELECT r.id, r.company_id, r.name, r.kind, r.field, r.operator, r.value, r.event_type,
            r.window_days, r.max_count, r.points, r.is_active, r.sort_order, r.created_at, r.updated_at
     FROM crm.crm_scoring_rules r WHERE ${where}
     ORDER BY r.sort_order, r.created_at`,
    params
  );
  return successResponse(rows);
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const parsed = scoringRuleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const row = await queryOne(
    `INSERT INTO crm.crm_scoring_rules
       (company_id, name, kind, field, operator, value, event_type, window_days, max_count, points, is_active, sort_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, name, kind, points, is_active`,
    [
      ruleCompanyId(user, scope), b.name, b.kind,
      b.kind === "field" ? b.field : null, b.kind === "field" ? b.operator : null,
      b.value === undefined ? null : JSON.stringify(b.value),
      b.kind === "event" ? b.event_type : null, b.window_days ?? null, b.max_count, b.points, b.is_active, b.sort_order, user.id,
    ]
  );
  return createdResponse(row, "Aturan scoring dibuat");
}
