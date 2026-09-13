import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser } from "@/lib/crm/advance-guard";
import { scoringRuleSchema } from "@/lib/crm/scoring";

async function accessible(id: string, companyId: string | null | undefined, isSuper: boolean) {
  return queryOne<{ id: string; company_id: string | null }>(
    `SELECT id, company_id FROM crm.crm_scoring_rules WHERE id = $1`,
    [id]
  ).then((row) => {
    if (!row) return null;
    if (isSuper) return row;
    if (row.company_id && companyId && row.company_id !== companyId) return null;
    return row;
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  const row = await accessible(id, scope?.companyId, user.role === "super_admin");
  if (!row) return NextResponse.json({ success: false, error: "Aturan tidak ditemukan" }, { status: 404 });
  const parsed = scoringRuleSchema.partial().safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    values.push(key === "value" ? JSON.stringify(value) : value);
    sets.push(`${key} = $${values.length}${key === "value" ? "::jsonb" : ""}`);
  }
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  values.push(id);
  const updated = await queryOne(
    `UPDATE crm.crm_scoring_rules SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, name, points, is_active`,
    values
  );
  return successResponse(updated, "Aturan diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  const row = await accessible(id, scope?.companyId, user.role === "super_admin");
  if (!row) return NextResponse.json({ success: false, error: "Aturan tidak ditemukan" }, { status: 404 });
  await query(`DELETE FROM crm.crm_scoring_rules WHERE id = $1`, [id]);
  return noContentResponse();
}
