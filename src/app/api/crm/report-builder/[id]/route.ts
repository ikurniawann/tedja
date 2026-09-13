import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { reportSchema } from "@/lib/crm/report-builder";
import {
  canManageShared, loadAccessibleReport, parseStoredDefinition, requireReportUser, runReportDefinition,
} from "@/lib/crm/report-builder-server";

/** GET = jalankan report tersimpan (?meta=1 hanya definisi). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const { id } = await params;
  const report = await loadAccessibleReport(id, user, scope);
  if (!report) return NextResponse.json({ success: false, error: "Report tidak ditemukan" }, { status: 404 });
  const definition = parseStoredDefinition(report.dataset, report.definition);
  if (new URL(request.url).searchParams.get("meta") === "1") {
    return successResponse({ report: { ...report, definition } });
  }
  const result = await runReportDefinition(definition, user, scope);
  return successResponse({ report: { ...report, definition }, result });
}

function canEdit(report: { created_by: string | null }, user: { id: string; role: string }): boolean {
  return report.created_by === user.id || user.role === "super_admin" || user.role === "admin";
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const { id } = await params;
  const report = await loadAccessibleReport(id, user, scope);
  if (!report) return NextResponse.json({ success: false, error: "Report tidak ditemukan" }, { status: 404 });
  if (!canEdit(report, user)) return NextResponse.json({ success: false, error: "Hanya pembuat atau admin yang bisa mengubah report ini" }, { status: 403 });
  const parsed = reportSchema.partial().safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (col: string, v: unknown, cast = "") => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (b.name !== undefined) push("name", b.name);
  if (b.description !== undefined) push("description", b.description ?? null);
  if (b.definition !== undefined) { push("definition", JSON.stringify(b.definition), "::jsonb"); push("dataset", b.definition.dataset); }
  if (b.is_shared !== undefined) push("is_shared", b.is_shared && !canManageShared(user) ? false : b.is_shared);
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  values.push(id);
  const row = await queryOne(
    `UPDATE crm.crm_reports SET ${sets.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL
     RETURNING id, name, dataset, is_shared`,
    values
  );
  return successResponse(row, "Report diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const { id } = await params;
  const report = await loadAccessibleReport(id, user, scope);
  if (!report) return NextResponse.json({ success: false, error: "Report tidak ditemukan" }, { status: 404 });
  if (!canEdit(report, user)) return NextResponse.json({ success: false, error: "Hanya pembuat atau admin yang bisa menghapus report ini" }, { status: 403 });
  await queryOne(`UPDATE crm.crm_reports SET deleted_at = now() WHERE id = $1 RETURNING id`, [id]);
  return noContentResponse();
}
