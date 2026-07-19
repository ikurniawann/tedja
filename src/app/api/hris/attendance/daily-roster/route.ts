import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { isoDayOfWeek } from "@/lib/hris/shifts";
import {
  deriveRosterStatus,
  isOverdue,
  type RosterStatus,
} from "@/lib/hris/daily-roster";

/**
 * GET /api/hris/attendance/daily-roster?date=YYYY-MM-DD — roster kehadiran
 * satu hari utk monitoring HRD: semua karyawan aktif + shift terjadwalnya,
 * siapa sudah/belum absen, terlambat, cuti, libur, atau tanpa jadwal.
 * Shift malam (overnight) masuk roster pada tanggal MULAI shiftnya,
 * konsisten dengan kolom `date` saat clock-in. Khusus HR.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal hari ini menurut WIB (konsisten dgn clock-in). */
function todayWib(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().split("T")[0];
}

interface RosterQueryRow {
  employee_id: string;
  full_name: string;
  nip: string | null;
  photo_url: string | null;
  department_name: string | null;
  job_title: string | null;
  has_schedule: boolean;
  scheduled_shift_id: string | null;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  late_tolerance_minutes: number | null;
  is_overnight: boolean | null;
  attendance_id: string | null;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: string | null;
  is_late: boolean | null;
  late_minutes: number | null;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  attendance_shift_id: string | null;
  leave_id: string | null;
  leave_type: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!actor.isHr) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const requested = req.nextUrl.searchParams.get("date");
    if (requested && !DATE_RE.test(requested)) {
      return NextResponse.json({ error: "Format tanggal tidak valid" }, { status: 400 });
    }
    const date = requested || todayWib();
    const today = todayWib();
    const dow = isoDayOfWeek(date);

    const [rows, shifts] = await Promise.all([
      query<RosterQueryRow>(
        `WITH scheduled AS (
           SELECT DISTINCT ON (es.employee_id)
                  es.employee_id, es.shift_id
           FROM hris.employee_shifts es
           WHERE es.day_of_week = $2
             AND es.effective_from <= $1::date
             AND (es.effective_to IS NULL OR es.effective_to >= $1::date)
           ORDER BY es.employee_id, es.effective_from DESC
         )
         SELECT e.id AS employee_id, e.full_name, e.nip, e.photo_url,
                d.name AS department_name, p.title AS job_title,
                (sc.employee_id IS NOT NULL) AS has_schedule,
                sc.shift_id AS scheduled_shift_id,
                s.name AS shift_name,
                s.start_time::text AS shift_start,
                s.end_time::text AS shift_end,
                s.late_tolerance_minutes, s.is_overnight,
                a.id AS attendance_id, a.clock_in, a.clock_out,
                a.work_hours::text, a.is_late, a.late_minutes,
                a.clock_in_photo_url, a.clock_out_photo_url,
                a.shift_id AS attendance_shift_id,
                l.id AS leave_id, l.leave_type::text
         FROM hris.employees e
         LEFT JOIN scheduled sc ON sc.employee_id = e.id
         LEFT JOIN hris.shifts s ON s.id = sc.shift_id
         LEFT JOIN hris.attendance a
           ON a.employee_id = e.id AND a.date = $1::date
         LEFT JOIN LATERAL (
           SELECT lv.id, lv.leave_type
           FROM hris.leaves lv
           WHERE lv.employee_id = e.id AND lv.status = 'approved'
             AND lv.start_date <= $1::date AND lv.end_date >= $1::date
           ORDER BY lv.created_at DESC LIMIT 1
         ) l ON true
         LEFT JOIN hris.departments d ON d.id = e.department_id
         LEFT JOIN hris.positions p ON p.id = e.job_title_id
         WHERE e.is_active
           AND NOT EXISTS (
             SELECT 1 FROM configuration.users u
             WHERE u.id = e.user_id AND u.role = 'super_admin')
         ORDER BY e.full_name`,
        [date, dow]
      ),
      query<{
        id: string;
        name: string;
        start_time: string;
        end_time: string;
        is_overnight: boolean;
        sort_order: number | null;
      }>(
        `SELECT id, name, start_time::text, end_time::text, is_overnight, sort_order
         FROM hris.shifts WHERE is_active
         ORDER BY sort_order NULLS LAST, start_time`
      ),
    ]);

    const now = new Date();
    const isPastDate = date < today;

    const summary: Record<RosterStatus | "scheduled", number> = {
      scheduled: 0,
      hadir: 0,
      terlambat: 0,
      belum_absen: 0,
      absen: 0,
      cuti: 0,
      libur: 0,
      tanpa_jadwal: 0,
    };

    const employees = rows.map((row) => {
      const shift =
        row.scheduled_shift_id && row.shift_start && row.shift_end
          ? {
              id: row.scheduled_shift_id,
              name: row.shift_name ?? "",
              start_time: row.shift_start,
              end_time: row.shift_end,
              late_tolerance_minutes: row.late_tolerance_minutes ?? 0,
              is_overnight: row.is_overnight ?? false,
            }
          : null;

      const status = deriveRosterStatus({
        hasAttendance: row.attendance_id !== null,
        isLate: row.is_late ?? false,
        onApprovedLeave: row.leave_id !== null,
        hasSchedule: row.has_schedule,
        shiftId: row.scheduled_shift_id,
        isPastDate,
      });

      summary[status] += 1;
      if (shift) summary.scheduled += 1;

      return {
        employee_id: row.employee_id,
        full_name: row.full_name,
        nip: row.nip,
        photo_url: row.photo_url,
        department_name: row.department_name,
        job_title: row.job_title,
        shift,
        status,
        is_overdue: isOverdue(now, date, shift, status),
        attendance: row.attendance_id
          ? {
              id: row.attendance_id,
              clock_in: row.clock_in,
              clock_out: row.clock_out,
              work_hours: row.work_hours ? Number(row.work_hours) : null,
              is_late: row.is_late ?? false,
              late_minutes: row.late_minutes ?? 0,
              clock_in_photo_url: row.clock_in_photo_url,
              clock_out_photo_url: row.clock_out_photo_url,
              shift_id: row.attendance_shift_id,
            }
          : null,
        leave: row.leave_id ? { id: row.leave_id, leave_type: row.leave_type } : null,
      };
    });

    return NextResponse.json({
      data: {
        date,
        day_of_week: dow,
        is_today: date === today,
        summary,
        shifts,
        employees,
      },
    });
  } catch (error) {
    console.error("[attendance/daily-roster] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
