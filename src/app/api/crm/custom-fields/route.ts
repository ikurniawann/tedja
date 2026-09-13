import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser, ruleCompanyId, ruleVisibilityWhere } from "@/lib/crm/advance-guard";
import { customFieldSchema } from "@/lib/crm/custom-fields";

/** EPIC-050 T-3.3 — registry custom field (Pengaturan CRM → Custom Fields). */
export async function GET(request: NextRequest) {
  const { error, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const object = new URL(request.url).searchParams.get("object");
  const params: unknown[] = [];
  const where = ruleVisibilityWhere("f", scope, params);
  let objWhere = "";
  if (object) {
    params.push(object);
    objWhere = ` AND f.object = $${params.length}`;
  }
  const rows = await query(
    `SELECT f.id, f.company_id, f.object, f.key, f.label, f.field_type, f.options, f.is_required, f.validation,
            f.help_text, f.show_in_list, f.sort_order, f.is_active, f.created_at
     FROM crm.crm_custom_fields f WHERE ${where}${objWhere} ORDER BY f.object, f.sort_order, f.created_at`,
    params
  );
  return successResponse(rows);
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const parsed = customFieldSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const companyId = ruleCompanyId(user, scope);
  const dup = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_custom_fields WHERE object = $1 AND key = $2 AND (company_id IS NULL OR company_id = $3)`,
    [b.object, b.key, companyId]
  );
  if (dup) return NextResponse.json({ success: false, error: "Key sudah dipakai untuk objek ini" }, { status: 409 });
  const row = await queryOne(
    `INSERT INTO crm.crm_custom_fields
       (company_id, object, key, label, field_type, options, is_required, validation, help_text, show_in_list, sort_order, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13)
     RETURNING id, object, key, label, field_type`,
    [companyId, b.object, b.key, b.label, b.field_type, JSON.stringify(b.options), b.is_required, JSON.stringify(b.validation),
     b.help_text ?? null, b.show_in_list, b.sort_order, b.is_active, user.id]
  );
  return createdResponse(row, "Custom field dibuat");
}
