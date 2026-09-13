import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser } from "@/lib/crm/advance-guard";
import { customFieldSchema } from "@/lib/crm/custom-fields";

async function accessible(id: string, companyId: string | null | undefined, isSuper: boolean) {
  const row = await queryOne<{ id: string; company_id: string | null }>(`SELECT id, company_id FROM crm.crm_custom_fields WHERE id = $1`, [id]);
  if (!row) return null;
  if (!isSuper && row.company_id && companyId && row.company_id !== companyId) return null;
  return row;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId, user.role === "super_admin"))) {
    return NextResponse.json({ success: false, error: "Field tidak ditemukan" }, { status: 404 });
  }
  // key & object tidak boleh diubah (nilai tersimpan mengacu key)
  const parsed = customFieldSchema.partial().omit({ key: true, object: true }).safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    const isJson = k === "options" || k === "validation";
    values.push(isJson ? JSON.stringify(v) : v);
    sets.push(`${k} = $${values.length}${isJson ? "::jsonb" : ""}`);
  }
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  values.push(id);
  const row = await queryOne(`UPDATE crm.crm_custom_fields SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, key, label, is_active`, values);
  return successResponse(row, "Custom field diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId, user.role === "super_admin"))) {
    return NextResponse.json({ success: false, error: "Field tidak ditemukan" }, { status: 404 });
  }
  // nilai tersimpan di record tidak dihapus — hanya definisinya
  await query(`DELETE FROM crm.crm_custom_fields WHERE id = $1`, [id]);
  return noContentResponse();
}
