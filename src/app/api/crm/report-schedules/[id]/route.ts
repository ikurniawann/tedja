import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { canManageShared, requireReportUser } from "@/lib/crm/report-builder-server";
import { computeNextRun, reportScheduleSchema } from "@/lib/crm/report-schedule";
import { runReportSchedule } from "@/lib/crm/report-schedule-watcher";

interface ScheduleRow {
  id: string; company_id: string | null; frequency: "daily" | "weekly" | "monthly";
  hour: number; day_of_week: number | null; day_of_month: number | null; is_active: boolean;
}

async function loadSchedule(id: string, companyId: string | null | undefined): Promise<ScheduleRow | null> {
  const params: unknown[] = [id];
  let where = "id = $1";
  if (companyId) {
    params.push(companyId);
    where += ` AND (company_id IS NULL OR company_id = $${params.length})`;
  }
  return queryOne<ScheduleRow>(
    `SELECT id, company_id, frequency, hour, day_of_week, day_of_month, is_active FROM crm.crm_report_schedules WHERE ${where}`,
    params
  );
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  if (!canManageShared(user)) return NextResponse.json({ success: false, error: "Hanya admin yang bisa mengubah jadwal" }, { status: 403 });
  const { id } = await params;
  const current = await loadSchedule(id, scope?.companyId);
  if (!current) return NextResponse.json({ success: false, error: "Jadwal tidak ditemukan" }, { status: 404 });
  const parsed = reportScheduleSchema.partial().safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (col: string, v: unknown, cast = "") => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (b.name !== undefined) push("name", b.name);
  if (b.frequency !== undefined) push("frequency", b.frequency);
  if (b.hour !== undefined) push("hour", b.hour);
  if (b.day_of_week !== undefined) push("day_of_week", b.day_of_week ?? null);
  if (b.day_of_month !== undefined) push("day_of_month", b.day_of_month ?? null);
  if (b.channel !== undefined) push("channel", b.channel);
  if (b.recipients !== undefined) push("recipients", JSON.stringify(b.recipients), "::jsonb");
  if (b.is_active !== undefined) push("is_active", b.is_active);
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  // Waktu jalan berikutnya dihitung ulang bila pola atau status aktif berubah.
  const next = { ...current, ...b };
  push("next_run_at", next.is_active ? computeNextRun(next) : null);
  values.push(id);
  const row = await queryOne(
    `UPDATE crm.crm_report_schedules SET ${sets.join(", ")} WHERE id = $${values.length}
     RETURNING id, name, frequency, is_active, next_run_at`,
    values
  );
  return successResponse(row, "Jadwal diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  if (!canManageShared(user)) return NextResponse.json({ success: false, error: "Hanya admin yang bisa menghapus jadwal" }, { status: 403 });
  const { id } = await params;
  if (!(await loadSchedule(id, scope?.companyId))) {
    return NextResponse.json({ success: false, error: "Jadwal tidak ditemukan" }, { status: 404 });
  }
  await query(`DELETE FROM crm.crm_report_schedules WHERE id = $1`, [id]);
  return noContentResponse();
}

/** POST = kirim sekarang (uji coba), tanpa menggeser jadwal berikutnya. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  if (!canManageShared(user)) return NextResponse.json({ success: false, error: "Hanya admin yang bisa mengirim uji coba" }, { status: 403 });
  const { id } = await params;
  if (!(await loadSchedule(id, scope?.companyId))) {
    return NextResponse.json({ success: false, error: "Jadwal tidak ditemukan" }, { status: 404 });
  }
  const result = await runReportSchedule(id, { advanceNextRun: false });
  if (!result.ok) return NextResponse.json({ success: false, error: result.reason ?? "Gagal mengirim" }, { status: 400 });
  return successResponse(result, `Terkirim ke ${result.sent} penerima`);
}
