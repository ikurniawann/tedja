import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser } from "@/lib/crm/advance-guard";
import { workflowRuleSchema } from "@/lib/crm/workflow";

async function accessible(id: string, companyId: string | null | undefined, isSuper: boolean) {
  const row = await queryOne<{ id: string; company_id: string | null }>(`SELECT id, company_id FROM crm.crm_workflow_rules WHERE id = $1`, [id]);
  if (!row) return null;
  if (!isSuper && row.company_id && companyId && row.company_id !== companyId) return null;
  return row;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId, user.role === "super_admin"))) {
    return NextResponse.json({ success: false, error: "Rule tidak ditemukan" }, { status: 404 });
  }
  const row = await queryOne(`SELECT * FROM crm.crm_workflow_rules WHERE id = $1`, [id]);
  return successResponse(row);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId, user.role === "super_admin"))) {
    return NextResponse.json({ success: false, error: "Rule tidak ditemukan" }, { status: 404 });
  }
  const body = await request.json();
  // toggle cepat (is_active saja) tidak perlu validasi penuh
  const keys = Object.keys(body ?? {});
  if (keys.length === 1 && keys[0] === "is_active" && typeof body.is_active === "boolean") {
    const row = await queryOne(`UPDATE crm.crm_workflow_rules SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id, is_active`, [id, body.is_active]);
    return successResponse(row, body.is_active ? "Rule diaktifkan" : "Rule dinonaktifkan");
  }
  const parsed = workflowRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const row = await queryOne(
    `UPDATE crm.crm_workflow_rules
     SET name = $2, description = $3, object = $4, trigger_type = $5, trigger_config = $6::jsonb,
         conditions = $7::jsonb, actions = $8::jsonb, run_once_per_record = $9, is_active = $10, updated_at = now()
     WHERE id = $1 RETURNING id, name, object, trigger_type, is_active`,
    [id, b.name, b.description ?? null, b.object, b.trigger_type, JSON.stringify(b.trigger_config ?? {}),
     JSON.stringify(b.conditions ?? []), JSON.stringify(b.actions), b.run_once_per_record, b.is_active]
  );
  return successResponse(row, "Workflow rule diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId, user.role === "super_admin"))) {
    return NextResponse.json({ success: false, error: "Rule tidak ditemukan" }, { status: 404 });
  }
  await query(`DELETE FROM crm.crm_workflow_rules WHERE id = $1`, [id]);
  return noContentResponse();
}
