import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser } from "@/lib/crm/advance-guard";
import { approvalRuleSchema } from "@/lib/crm/approvals";

async function accessible(id: string, companyId: string | null | undefined, isSuper: boolean) {
  const row = await queryOne<{ id: string; company_id: string | null }>(`SELECT id, company_id FROM crm.crm_approval_rules WHERE id = $1`, [id]);
  if (!row) return null;
  if (!isSuper && row.company_id && companyId && row.company_id !== companyId) return null;
  return row;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId, user.role === "super_admin"))) {
    return NextResponse.json({ success: false, error: "Aturan tidak ditemukan" }, { status: 404 });
  }
  const parsed = approvalRuleSchema.partial().safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    values.push(value === "" ? null : value);
    sets.push(`${key} = $${values.length}`);
  }
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  values.push(id);
  const row = await queryOne(
    `UPDATE crm.crm_approval_rules SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, name, level, min_discount_percent, is_active`,
    values
  );
  return successResponse(row, "Aturan diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId, user.role === "super_admin"))) {
    return NextResponse.json({ success: false, error: "Aturan tidak ditemukan" }, { status: 404 });
  }
  await query(`DELETE FROM crm.crm_approval_rules WHERE id = $1`, [id]);
  return noContentResponse();
}
