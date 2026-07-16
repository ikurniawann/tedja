import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * GET /api/hris/attendance/stats?month=7&year=2026 — statistik absensi bulan
 * berjalan utk halaman rekap HRD: hadir hari ini, terlambat bulan ini,
 * di luar jadwal, rata-rata jam kerja. Non-HR dibatasi datanya sendiri.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date(Date.now() + 7 * 3600_000);
    const month = Number(req.nextUrl.searchParams.get("month")) || now.getUTCMonth() + 1;
    const year = Number(req.nextUrl.searchParams.get("year")) || now.getUTCFullYear();
    const employeeFilter = actor.isHr ? null : actor.employeeId;
    if (!actor.isHr && !employeeFilter) {
      return NextResponse.json(
        { error: "Akun ini tidak terhubung ke data karyawan" },
        { status: 403 }
      );
    }

    const [monthly, todayRow] = await Promise.all([
      queryOne<{
        total_records: string;
        late_count: string;
        off_schedule: string;
        avg_work_hours: string | null;
      }>(
        `SELECT count(*) AS total_records,
                count(*) FILTER (WHERE is_late) AS late_count,
                count(*) FILTER (WHERE shift_id IS NULL) AS off_schedule,
                round(avg(work_hours), 1) AS avg_work_hours
         FROM hris.attendance
         WHERE date_part('month', date) = $1 AND date_part('year', date) = $2
           AND ($3::uuid IS NULL OR employee_id = $3)`,
        [month, year, employeeFilter]
      ),
      queryOne<{ present_today: string; late_today: string }>(
        `SELECT count(*) AS present_today,
                count(*) FILTER (WHERE is_late) AS late_today
         FROM hris.attendance
         WHERE date = (now() + interval '7 hours')::date
           AND ($1::uuid IS NULL OR employee_id = $1)`,
        [employeeFilter]
      ),
    ]);

    const activeEmployees = actor.isHr
      ? await queryOne<{ count: string }>(
          `SELECT count(*) FROM hris.employees e
           WHERE e.is_active
             AND NOT EXISTS (
               SELECT 1 FROM configuration.users u
               WHERE u.id = e.user_id AND u.role = 'super_admin')`
        )
      : null;

    return NextResponse.json({
      data: {
        month,
        year,
        present_today: Number(todayRow?.present_today ?? 0),
        late_today: Number(todayRow?.late_today ?? 0),
        active_employees: activeEmployees ? Number(activeEmployees.count) : null,
        month_records: Number(monthly?.total_records ?? 0),
        month_late: Number(monthly?.late_count ?? 0),
        month_off_schedule: Number(monthly?.off_schedule ?? 0),
        avg_work_hours: monthly?.avg_work_hours ? Number(monthly.avg_work_hours) : null,
      },
    });
  } catch (error) {
    console.error("[attendance/stats] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
