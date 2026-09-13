import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { reportSchema } from "@/lib/crm/report-builder";
import { canManageShared, reportCompanyId, reportVisibilityWhere, requireReportUser } from "@/lib/crm/report-builder-server";

/** EPIC-050 T-4.1 — daftar & buat report tersimpan. */
export async function GET(request: NextRequest) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const params: unknown[] = [];
  const visibility = reportVisibilityWhere("r", user, scope, params);
  const dataset = new URL(request.url).searchParams.get("dataset");
  let extra = "";
  if (dataset) {
    params.push(dataset);
    extra = ` AND r.dataset = $${params.length}`;
  }
  const rows = await query(
    `SELECT r.id, r.company_id, r.name, r.description, r.dataset, r.definition, r.is_shared,
            r.created_by, r.created_at, r.updated_at, u.full_name AS creator_name,
            (SELECT COUNT(*) FROM crm.crm_report_schedules s WHERE s.report_id = r.id AND s.is_active) AS active_schedules
     FROM crm.crm_reports r
     LEFT JOIN configuration.users u ON u.id = r.created_by
     WHERE r.deleted_at IS NULL AND ${visibility}${extra}
     ORDER BY r.updated_at DESC`,
    params
  );
  return successResponse(rows);
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const parsed = reportSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const isShared = b.is_shared && !canManageShared(user) ? false : b.is_shared;
  const row = await queryOne(
    `INSERT INTO crm.crm_reports (company_id, name, description, dataset, definition, is_shared, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, name, dataset, is_shared`,
    [reportCompanyId(user, scope), b.name, b.description ?? null, b.definition.dataset, JSON.stringify(b.definition), isShared, user.id]
  );
  return createdResponse(row, "Report disimpan");
}
