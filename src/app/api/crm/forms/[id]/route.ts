import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { publicFormSchema } from "@/lib/crm/public-forms";
import { requireSegmentUser } from "@/lib/crm/segments-server";

async function accessible(id: string, companyId: string | null | undefined) {
  const params: unknown[] = [id];
  let where = "id = $1 AND deleted_at IS NULL";
  if (companyId) {
    params.push(companyId);
    where += ` AND (company_id IS NULL OR company_id = $${params.length})`;
  }
  return queryOne<{ id: string; slug: string }>(`SELECT id, slug FROM crm.crm_forms WHERE ${where}`, params);
}

/** Kiriman terakhir form — untuk memantau spam & konversi. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId))) {
    return NextResponse.json({ success: false, error: "Form tidak ditemukan" }, { status: 404 });
  }
  const rows = await query(
    `SELECT s.id, s.lead_id, s.status, s.reason, s.utm, s.created_at,
            l.org_name, l.pic_name, l.pic_phone
     FROM crm.crm_form_submissions s
     LEFT JOIN crm.crm_sales_leads l ON l.id = s.lead_id
     WHERE s.form_id = $1
     ORDER BY s.created_at DESC
     LIMIT 50`,
    [id]
  );
  return successResponse(rows);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const { id } = await params;
  if (!(await accessible(id, scope?.companyId))) {
    return NextResponse.json({ success: false, error: "Form tidak ditemukan" }, { status: 404 });
  }
  // Slug tidak boleh diubah: URL publik yang sudah disebar akan mati.
  const parsed = publicFormSchema.partial().omit({ slug: true }).safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (col: string, v: unknown, cast = "") => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (b.name !== undefined) push("name", b.name);
  if (b.title !== undefined) push("title", b.title);
  if (b.description !== undefined) push("description", b.description ?? null);
  if (b.fields !== undefined) push("fields", JSON.stringify(b.fields), "::jsonb");
  if (b.submit_label !== undefined) push("submit_label", b.submit_label);
  if (b.success_message !== undefined) push("success_message", b.success_message);
  if (b.redirect_url !== undefined) push("redirect_url", b.redirect_url ?? null);
  if (b.default_source !== undefined) push("default_source", b.default_source);
  if (b.notify_user_ids !== undefined) push("notify_user_ids", JSON.stringify(b.notify_user_ids), "::jsonb");
  if (b.notify_numbers !== undefined) push("notify_numbers", JSON.stringify(b.notify_numbers), "::jsonb");
  if (b.is_active !== undefined) push("is_active", b.is_active);
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  values.push(id);
  const row = await queryOne(
    `UPDATE crm.crm_forms SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, slug, name, is_active`,
    values
  );
  return successResponse(row, "Form diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const { id } = await params;
  const form = await accessible(id, scope?.companyId);
  if (!form) return NextResponse.json({ success: false, error: "Form tidak ditemukan" }, { status: 404 });
  if (form.slug === "kontak") {
    return NextResponse.json({ success: false, error: "Form utama /public tidak bisa dihapus — nonaktifkan saja" }, { status: 409 });
  }
  await query(`UPDATE crm.crm_forms SET deleted_at = now(), is_active = false WHERE id = $1`, [id]);
  return noContentResponse();
}
