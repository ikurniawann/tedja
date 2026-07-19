import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { resolveShiftForDate, type EmployeeShiftRow } from "@/lib/hris/shifts";

/**
 * GET /api/hris/me — identitas karyawan milik akun yang login + kuota cuti
 * tahun berjalan + shift hari ini. Dipakai halaman ESS (/dashboard/me/*).
 * employee null bila akun tidak tertaut record karyawan (mis. super admin).
 */

function todayWibIso(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!actor.employeeId) {
      return NextResponse.json({ data: { employee: null, leave_balance: null } });
    }

    const [employee, leaveBalance, scheduleRows] = await Promise.all([
      queryOne<{
        id: string;
        full_name: string;
        nip: string | null;
        join_date: string | null;
        employment_status: string;
        position_title: string | null;
        department_name: string | null;
      }>(
        `SELECT e.id, e.full_name, e.nip, e.join_date, e.employment_status,
                p.title AS position_title, d.name AS department_name
         FROM hris.employees e
         LEFT JOIN hris.positions p ON p.id = e.job_title_id
         LEFT JOIN hris.departments d ON d.id = e.department_id
         WHERE e.id = $1`,
        [actor.employeeId]
      ),
      queryOne<{
        year: number;
        annual_leave_total: string;
        annual_leave_used: string;
        annual_leave_remaining: string;
      }>(
        `SELECT year, annual_leave_total, annual_leave_used, annual_leave_remaining
         FROM hris.leave_balances
         WHERE employee_id = $1 AND year = date_part('year', now())::int`,
        [actor.employeeId]
      ),
      query<EmployeeShiftRow & { shift_name: string | null; start_time: string | null; end_time: string | null; late_tolerance_minutes: number | null }>(
        `SELECT es.day_of_week, es.shift_id,
                es.effective_from::text, es.effective_to::text,
                s.name AS shift_name, s.start_time::text, s.end_time::text,
                s.late_tolerance_minutes
         FROM hris.employee_shifts es
         LEFT JOIN hris.shifts s ON s.id = es.shift_id
         WHERE es.employee_id = $1`,
        [actor.employeeId]
      ),
    ]);

    const today = todayWibIso();
    const todayRow = resolveShiftForDate(scheduleRows, today);
    const shiftDetail = todayRow
      ? scheduleRows.find((row) => row.shift_id === todayRow.shift_id && row.shift_name)
      : null;
    const todayShift =
      todayRow && shiftDetail?.shift_name
        ? {
            name: shiftDetail.shift_name,
            start_time: shiftDetail.start_time,
            end_time: shiftDetail.end_time,
            late_tolerance_minutes: shiftDetail.late_tolerance_minutes ?? 0,
          }
        : null;
    const hasSchedule = scheduleRows.length > 0;

    return NextResponse.json({
      data: {
        employee,
        leave_balance: leaveBalance,
        today_shift: todayShift,
        has_schedule: hasSchedule,
      },
    });
  } catch (error) {
    console.error("[hris/me] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
