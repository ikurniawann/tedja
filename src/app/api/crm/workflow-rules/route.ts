import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser, ruleCompanyId, ruleVisibilityWhere } from "@/lib/crm/advance-guard";
import { workflowRuleSchema } from "@/lib/crm/workflow";

const COLS = `r.id, r.company_id, r.name, r.description, r.object, r.trigger_type, r.trigger_config,
  r.conditions, r.actions, r.run_once_per_record, r.is_active, r.last_run_at, r.run_count, r.created_at, r.updated_at`;

/** EPIC-050 T-2.3 — workflow rules. */
export async function GET() {
  const { error, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const params: unknown[] = [];
  const where = ruleVisibilityWhere("r", scope, params);
  const rows = await query(`SELECT ${COLS} FROM crm.crm_workflow_rules r WHERE ${where} ORDER BY r.created_at DESC`, params);
  return successResponse(rows);
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const parsed = workflowRuleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const row = await queryOne(
    `INSERT INTO crm.crm_workflow_rules
       (company_id, name, description, object, trigger_type, trigger_config, conditions, actions, run_once_per_record, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
     RETURNING id, name, object, trigger_type, is_active`,
    [
      ruleCompanyId(user, scope), b.name, b.description ?? null, b.object, b.trigger_type,
      JSON.stringify(b.trigger_config ?? {}), JSON.stringify(b.conditions ?? []), JSON.stringify(b.actions),
      b.run_once_per_record, b.is_active, user.id,
    ]
  );
  return createdResponse(row, "Workflow rule dibuat");
}
