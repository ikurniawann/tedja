import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { canManageShared, loadAccessibleReport, reportCompanyId, requireReportUser } from "@/lib/crm/report-builder-server";
import { computeNextRun, reportScheduleSchema } from "@/lib/crm/report-schedule";

/** EPIC-050 T-4.3 — daftar & buat report terjadwal. */
export async function GET() {
  const { error, scope } = await requireReportUser();
  if (error) return error;
  const params: unknown[] = [];
  let where = "TRUE";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where = `(s.company_id IS NULL OR s.company_id = $${params.length})`;
  }
  const rows = await query(
    `SELECT s.id, s.company_id, s.report_id, s.name, s.frequency, s.hour, s.day_of_week, s.day_of_month,
            s.channel, s.recipients, s.is_active, s.last_run_at, s.last_status, s.last_error, s.next_run_at,
            s.created_at, r.name AS report_name, r.dataset
     FROM crm.crm_report_schedules s
     JOIN crm.crm_reports r ON r.id = s.report_id AND r.deleted_at IS NULL
     WHERE ${where}
     ORDER BY s.is_active DESC, s.next_run_at NULLS LAST`,
    params
  );
  return successResponse(rows);
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  if (!canManageShared(user)) {
    return NextResponse.json({ success: false, error: "Hanya admin yang bisa membuat laporan terjadwal" }, { status: 403 });
  }
  const parsed = reportScheduleSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  if (!(await loadAccessibleReport(b.report_id, user, scope))) {
    return NextResponse.json({ success: false, error: "Report tidak ditemukan" }, { status: 404 });
  }
  const row = await queryOne(
    `INSERT INTO crm.crm_report_schedules
       (company_id, report_id, name, frequency, hour, day_of_week, day_of_month, channel, recipients, is_active, next_run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     RETURNING id, name, frequency, next_run_at`,
    [reportCompanyId(user, scope), b.report_id, b.name, b.frequency, b.hour, b.day_of_week ?? null, b.day_of_month ?? null,
     b.channel, JSON.stringify(b.recipients), b.is_active, b.is_active ? computeNextRun(b) : null, user.id]
  );
  return createdResponse(row, "Jadwal dibuat");
}
