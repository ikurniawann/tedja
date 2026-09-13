import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { DEFAULT_FORM_FIELDS, publicFormSchema } from "@/lib/crm/public-forms";
import { formFields } from "@/lib/crm/public-forms-server";
import { requireSegmentUser, segmentCompanyId } from "@/lib/crm/segments-server";

/** EPIC-050 T-5.3 — kelola form publik (dashboard). */
export async function GET() {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const params: unknown[] = [];
  let where = "f.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (f.company_id IS NULL OR f.company_id = $${params.length})`;
  }
  const rows = await query(
    `SELECT f.id, f.company_id, f.slug, f.name, f.title, f.description, f.fields, f.submit_label,
            f.success_message, f.redirect_url, f.default_source, f.notify_user_ids, f.notify_numbers,
            f.is_active, f.submission_count, f.created_at, f.updated_at,
            (SELECT COUNT(*) FROM crm.crm_form_submissions s WHERE s.form_id = f.id AND s.status = 'rejected') AS rejected_count,
            (SELECT MAX(s.created_at) FROM crm.crm_form_submissions s WHERE s.form_id = f.id) AS last_submission_at
     FROM crm.crm_forms f
     WHERE ${where}
     ORDER BY f.created_at`,
    params
  );
  // Kembalikan field efektif: form yang belum pernah disunting menyimpan array
  // kosong dan memakai field bawaan saat dirender.
  return successResponse(
    rows.map((r) => ({ ...(r as Record<string, unknown>), fields: formFields((r as { fields: unknown }).fields) }))
  );
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireSegmentUser();
  if (error) return error;
  const parsed = publicFormSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const dup = await queryOne<{ id: string }>(`SELECT id FROM crm.crm_forms WHERE slug = $1`, [b.slug]);
  if (dup) return NextResponse.json({ success: false, error: "Slug sudah dipakai form lain" }, { status: 409 });
  const row = await queryOne(
    `INSERT INTO crm.crm_forms
       (company_id, slug, name, title, description, fields, submit_label, success_message, redirect_url,
        default_source, notify_user_ids, notify_numbers, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14)
     RETURNING id, slug, name`,
    [
      segmentCompanyId(user, scope), b.slug, b.name, b.title, b.description ?? null,
      JSON.stringify(b.fields.length > 0 ? b.fields : DEFAULT_FORM_FIELDS),
      b.submit_label, b.success_message, b.redirect_url ?? null, b.default_source,
      JSON.stringify(b.notify_user_ids), JSON.stringify(b.notify_numbers), b.is_active, user.id,
    ]
  );
  return createdResponse(row, "Form dibuat");
}
