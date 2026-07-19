// ============================================================
// API Route: Beranda Karyawan (ESS home summary)
// GET — satu batch ringkasan utk /dashboard/me: identitas, saldo cuti,
//       shift hari ini + jadwal minggu ini, statistik absensi bulan
//       berjalan, slip gaji terbaru (paid), pinjaman aktif, pengajuan
//       terbaru (cuti/lembur/pinjaman), pengumuman teratas + belum dibaca,
//       ringkas KPI review terakhir. Nihil endpoint per-blok → 1 round trip.
// ============================================================

import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import {
  isoDayOfWeek,
  resolveScheduleRowForDate,
  type EmployeeShiftRow,
} from "@/lib/hris/shifts";

/** Baris jadwal + detail shift (join shifts) utk resolusi hari & minggu. */
type ScheduleRow = EmployeeShiftRow & {
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
  late_tolerance_minutes: number | null;
};

interface DaySchedule {
  date: string;
  day_of_week: number; // 1=Senin … 7=Minggu
  is_today: boolean;
  status: "shift" | "libur" | "none";
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
}

/** Tanggal WIB hari ini (YYYY-MM-DD). */
function todayWibIso(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Tanggal ISO + n hari (kalender polos, aman timezone). */
function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Detail shift (nama/jam) dari baris terpilih; null bila libur/tanpa jadwal. */
function shiftDetail(rows: ScheduleRow[], row: ScheduleRow | null) {
  if (!row || row.shift_id === null) return null;
  const detail = rows.find((r) => r.shift_id === row.shift_id && r.shift_name);
  return detail ?? row;
}

export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!actor.employeeId) {
      // Akun tak tertaut karyawan (mis. super admin murni) → tak ada beranda personal
      return NextResponse.json({ data: { employee: null } });
    }
    const emp = actor.employeeId;
    const today = todayWibIso();
    const now = new Date(Date.now() + 7 * 3600_000);
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();

    const [
      employee,
      leaveBalance,
      scheduleRows,
      attendance,
      payslip,
      loans,
      leaves,
      overtime,
      loanRequests,
      announcementRows,
      kpi,
    ] = await Promise.all([
      queryOne<{
        id: string;
        full_name: string;
        nip: string | null;
        join_date: string | null;
        employment_status: string;
        photo_url: string | null;
        position_title: string | null;
        department_name: string | null;
      }>(
        `SELECT e.id, e.full_name, e.nip, e.join_date::text, e.employment_status, e.photo_url,
                p.title AS position_title, d.name AS department_name
         FROM hris.employees e
         LEFT JOIN hris.positions p ON p.id = e.job_title_id
         LEFT JOIN hris.departments d ON d.id = e.department_id
         WHERE e.id = $1`,
        [emp]
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
        [emp]
      ),
      query<ScheduleRow>(
        `SELECT es.day_of_week, es.shift_id,
                es.effective_from::text, es.effective_to::text,
                s.name AS shift_name, s.start_time::text, s.end_time::text,
                s.late_tolerance_minutes
         FROM hris.employee_shifts es
         LEFT JOIN hris.shifts s ON s.id = es.shift_id
         WHERE es.employee_id = $1`,
        [emp]
      ),
      queryOne<{
        present: string;
        late: string;
        off_schedule: string;
        avg_work_hours: string | null;
        clocked_in_today: string;
      }>(
        `SELECT count(*) AS present,
                count(*) FILTER (WHERE is_late) AS late,
                count(*) FILTER (WHERE shift_id IS NULL) AS off_schedule,
                round(avg(work_hours), 1) AS avg_work_hours,
                count(*) FILTER (WHERE date = (now() + interval '7 hours')::date) AS clocked_in_today
         FROM hris.attendance
         WHERE employee_id = $1
           AND date_part('month', date) = $2 AND date_part('year', date) = $3`,
        [emp, month, year]
      ),
      queryOne<{
        net_salary: string;
        run_name: string | null;
        period_month: number;
        period_year: number;
        paid_at: string | null;
      }>(
        `SELECT pd.net_salary, pr.run_name, pr.period_month, pr.period_year, pr.paid_at::text
         FROM hris.payroll_details pd
         JOIN hris.payroll_runs pr ON pr.id = pd.payroll_run_id
         WHERE pd.employee_id = $1 AND pr.status = 'paid'
         ORDER BY pr.period_year DESC, pr.period_month DESC, pr.paid_at DESC NULLS LAST
         LIMIT 1`,
        [emp]
      ),
      queryOne<{
        count: string;
        total_remaining: string;
        monthly_installment: string;
      }>(
        `SELECT count(*) AS count,
                COALESCE(sum(remaining_balance), 0) AS total_remaining,
                COALESCE(sum(monthly_installment)
                         FILTER (WHERE status = 'approved' AND COALESCE(remaining_balance, 0) > 0), 0)
                  AS monthly_installment
         FROM hris.loans
         WHERE employee_id = $1 AND is_active
           AND status IN ('pending', 'approved')
           AND (status = 'pending' OR COALESCE(remaining_balance, 0) > 0)`,
        [emp]
      ),
      query<{
        id: string;
        leave_type: string;
        start_date: string;
        end_date: string;
        status: string;
        created_at: string;
      }>(
        `SELECT id, leave_type, start_date::text, end_date::text, status, created_at::text
         FROM hris.leaves WHERE employee_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [emp]
      ),
      query<{
        id: string;
        date: string;
        start_time: string;
        end_time: string;
        status: string;
        source: string;
        created_at: string;
      }>(
        `SELECT id, date::text, start_time::text, end_time::text, status, source, created_at::text
         FROM hris.overtime_requests WHERE employee_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [emp]
      ),
      query<{
        id: string;
        loan_type: string;
        principal_amount: string;
        status: string;
        created_at: string;
      }>(
        `SELECT id, loan_type, principal_amount, status, created_at::text
         FROM hris.loans WHERE employee_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [emp]
      ),
      query<{
        id: string;
        title: string;
        cover_image_url: string | null;
        tags: string[];
        is_pinned: boolean;
        publish_at: string | null;
        created_at: string;
        is_read: boolean;
      }>(
        `SELECT a.id, a.title, a.cover_image_url, a.tags, a.is_pinned,
                a.publish_at::text, a.created_at::text,
                (r.employee_id IS NOT NULL) AS is_read
         FROM hris.announcements a
         JOIN hris.employees e ON e.id = $1
         LEFT JOIN hris.announcement_reads r
           ON r.announcement_id = a.id AND r.employee_id = $1
         WHERE a.status = 'published'
           AND (a.publish_at IS NULL OR a.publish_at <= now())
           AND (a.expires_at IS NULL OR a.expires_at > now())
           AND (
             a.target_scope = 'global'
             OR EXISTS (
               SELECT 1 FROM hris.announcement_departments ad
               WHERE ad.announcement_id = a.id AND ad.department_id = e.department_id
             )
           )
         ORDER BY a.is_pinned DESC, COALESCE(a.publish_at, a.created_at) DESC
         LIMIT 20`,
        [emp]
      ),
      queryOne<{
        kpi_count: string;
        avg_achievement: string | null;
        avg_score: string | null;
      }>(
        `SELECT count(*) AS kpi_count,
                round(avg(achievement_percentage), 0) AS avg_achievement,
                round(avg(score)::numeric, 1) AS avg_score
         FROM hris.employee_kpis
         WHERE employee_id = $1
           AND review_id = (
             SELECT review_id FROM hris.employee_kpis
             WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1
           )`,
        [emp]
      ),
    ]);

    // ── Shift hari ini + jadwal minggu ini (Senin–Minggu) ──
    const todayRowRaw = resolveScheduleRowForDate(scheduleRows, today);
    const todayDetail = shiftDetail(scheduleRows, todayRowRaw);
    const todayShift =
      todayRowRaw && todayRowRaw.shift_id !== null && todayDetail?.shift_name
        ? {
            name: todayDetail.shift_name,
            start_time: todayDetail.start_time,
            end_time: todayDetail.end_time,
            late_tolerance_minutes: todayDetail.late_tolerance_minutes ?? 0,
          }
        : null;

    const mondayIso = addDaysIso(today, -(isoDayOfWeek(today) - 1));
    const weekSchedule: DaySchedule[] = Array.from({ length: 7 }, (_, i) => {
      const date = addDaysIso(mondayIso, i);
      const row = resolveScheduleRowForDate(scheduleRows, date);
      const detail = shiftDetail(scheduleRows, row);
      const status: DaySchedule["status"] =
        row === null ? "none" : row.shift_id === null ? "libur" : "shift";
      return {
        date,
        day_of_week: isoDayOfWeek(date),
        is_today: date === today,
        status,
        shift_name: status === "shift" ? detail?.shift_name ?? null : null,
        start_time: status === "shift" ? detail?.start_time ?? null : null,
        end_time: status === "shift" ? detail?.end_time ?? null : null,
      };
    });

    // ── Pengajuan terbaru (gabungan) — 6 teratas by created_at ──
    const recentRequests = [
      ...leaves.map((l) => ({
        kind: "cuti" as const,
        id: l.id,
        label: l.leave_type,
        detail: `${l.start_date} → ${l.end_date}`,
        status: l.status,
        created_at: l.created_at,
        href: "/dashboard/me/cuti",
      })),
      ...overtime.map((o) => ({
        kind: "lembur" as const,
        id: o.id,
        label: `Lembur ${o.date}`,
        detail: `${o.start_time?.slice(0, 5)}–${o.end_time?.slice(0, 5)}`,
        status: o.status,
        created_at: o.created_at,
        href: "/dashboard/me/lembur",
      })),
      ...loanRequests.map((p) => ({
        kind: "pinjaman" as const,
        id: p.id,
        label: p.loan_type,
        detail: `Rp ${Number(p.principal_amount).toLocaleString("id-ID")}`,
        status: p.status,
        created_at: p.created_at,
        href: "/dashboard/me/pinjaman",
      })),
    ]
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, 6);

    const announcementsUnread = announcementRows.filter((a) => !a.is_read).length;

    return NextResponse.json({
      data: {
        employee,
        leave_balance: leaveBalance,
        today_shift: todayShift,
        has_schedule: scheduleRows.length > 0,
        week_schedule: weekSchedule,
        attendance: {
          month,
          year,
          present: Number(attendance?.present ?? 0),
          late: Number(attendance?.late ?? 0),
          off_schedule: Number(attendance?.off_schedule ?? 0),
          avg_work_hours: attendance?.avg_work_hours ? Number(attendance.avg_work_hours) : null,
          clocked_in_today: Number(attendance?.clocked_in_today ?? 0) > 0,
        },
        latest_payslip: payslip
          ? {
              net_salary: Number(payslip.net_salary),
              run_name: payslip.run_name,
              period_month: payslip.period_month,
              period_year: payslip.period_year,
              paid_at: payslip.paid_at,
            }
          : null,
        active_loans: {
          count: Number(loans?.count ?? 0),
          total_remaining: Number(loans?.total_remaining ?? 0),
          monthly_installment: Number(loans?.monthly_installment ?? 0),
        },
        recent_requests: recentRequests,
        announcements: {
          items: announcementRows.slice(0, 4),
          unread: announcementsUnread,
          total: announcementRows.length,
        },
        kpi:
          kpi && Number(kpi.kpi_count) > 0
            ? {
                count: Number(kpi.kpi_count),
                avg_achievement: kpi.avg_achievement ? Number(kpi.avg_achievement) : null,
                avg_score: kpi.avg_score ? Number(kpi.avg_score) : null,
              }
            : null,
      },
    });
  } catch (error) {
    console.error("[hris/me/beranda] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
