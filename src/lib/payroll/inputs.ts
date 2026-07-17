/**
 * Payroll Input Loader
 *
 * Satu-satunya tempat pemuatan data karyawan untuk kalkulasi payroll —
 * dipakai baik oleh batch calculate (semua karyawan dalam satu run)
 * maupun perhitungan per-karyawan.
 *
 * Fase B: hari kerja dihitung dari pola shift (employee_shifts), lembur
 * dari pengajuan approved yang terealisasi (dicocokkan absensi), menit
 * keterlambatan dari absensi v2, dan cuti di-clamp ke periode.
 */

import { createServerPgClient } from "@/lib/pg/create-client";
import type { EmployeeShiftRow } from "@/lib/hris/shifts";
import {
  calculatePayroll,
  type PayrollInput,
  type PayrollResult,
} from "./calculator";
import { loadPayrollConfig, type PayrollConfig } from "./config";
import {
  clampedLeaveDays,
  computeLateStats,
  countScheduledDays,
  realizedOvertimeHours,
  type AttendancePeriodRow,
} from "./period";

type PgClient = Awaited<ReturnType<typeof createServerPgClient>>;

export interface EmployeeRow {
  id: string;
  full_name: string;
  join_date: string;
  employment_status: string;
}

/**
 * Fallback saat karyawan TIDAK punya pola shift sama sekali dan tidak ada
 * baris absensi pada periode — dilaporkan eksplisit via workingDaysSource.
 */
const FALLBACK_WORKING_DAYS = 20;

export type WorkingDaysSource = "shift_schedule" | "attendance" | "fallback";

function periodRange(periodMonth: number, periodYear: number) {
  const month = String(periodMonth).padStart(2, "0");
  const lastDay = new Date(periodYear, periodMonth, 0).getDate();
  return {
    startDate: `${periodYear}-${month}-01`,
    endDate: `${periodYear}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Muat PayrollInput seorang karyawan untuk satu periode.
 * Mengembalikan null bila karyawan belum punya struktur gaji aktif.
 */
export async function loadEmployeePayrollInput(
  db: PgClient,
  employee: EmployeeRow,
  periodMonth: number,
  periodYear: number,
  options: { includeThr?: boolean } = {}
): Promise<(PayrollInput & { workingDaysSource: WorkingDaysSource }) | null> {
  const { startDate, endDate } = periodRange(periodMonth, periodYear);

  const { data: salary } = await db
    .from("employee_salary")
    .select("*")
    .eq("employee_id", employee.id)
    .eq("is_active", true)
    .order("effective_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!salary) return null;

  const [
    { data: attendance },
    { data: scheduleRows },
    { data: overtimeRequests },
    { data: leaves },
  ] = await Promise.all([
    db
      .from("attendance")
      .select("date, status, clock_out, is_late, late_minutes, overtime_hours")
      .gte("date", startDate)
      .lte("date", endDate)
      .eq("employee_id", employee.id),
    db
      .from("employee_shifts")
      .select("day_of_week, shift_id, effective_from, effective_to")
      .eq("employee_id", employee.id)
      .lte("effective_from", endDate),
    db
      .from("overtime_requests")
      .select("date, hours")
      .eq("employee_id", employee.id)
      .eq("status", "approved")
      .gte("date", startDate)
      .lte("date", endDate),
    // Semua cuti approved yang BERSINGGUNGAN dengan periode (lintas bulan
    // dihitung porsinya saja) — sebelumnya hanya yang mulai di periode.
    db
      .from("leaves")
      .select("start_date, end_date, leave_type")
      .eq("employee_id", employee.id)
      .eq("status", "approved")
      .lte("start_date", endDate)
      .gte("end_date", startDate),
  ]);

  const attendanceRows: AttendancePeriodRow[] = attendance ?? [];
  const schedule: EmployeeShiftRow[] = (scheduleRows ?? []).filter(
    (row: EmployeeShiftRow) =>
      row.effective_to === null || row.effective_to >= startDate
  );

  // Hari kerja: pola shift (utama) → hitungan absensi → fallback 20
  const { scheduledDays, hasSchedule } = countScheduledDays(
    schedule,
    startDate,
    endDate
  );
  const attendanceWorkingDays = attendanceRows.filter(
    (d) => d.status !== "absent"
  ).length;

  let workingDays: number;
  let workingDaysSource: WorkingDaysSource;
  if (hasSchedule && scheduledDays > 0) {
    workingDays = scheduledDays;
    workingDaysSource = "shift_schedule";
  } else if (attendanceWorkingDays > 0) {
    workingDays = attendanceWorkingDays;
    workingDaysSource = "attendance";
  } else {
    workingDays = FALLBACK_WORKING_DAYS;
    workingDaysSource = "fallback";
  }

  const presentDays = attendanceRows.filter(
    (d) => d.status === "present" || d.status === "late"
  ).length;
  const { lateDays, lateMinutes } = computeLateStats(attendanceRows);

  // Lembur: hanya pengajuan approved yang terealisasi (ada clock_out)
  const overtimeHours = realizedOvertimeHours(
    (overtimeRequests ?? []).map(
      (r: { date: string; hours: unknown }) => ({
        date: r.date,
        hours: Number(r.hours) || 0,
      })
    ),
    attendanceRows
  );

  // Hanya cuti unpaid yang memotong gaji; cuti berbayar = hadir dibayar.
  const leaveRows: { start_date: string; end_date: string; leave_type: string }[] =
    leaves ?? [];
  const unpaidLeaveDays = leaveRows
    .filter((leave) => leave.leave_type === "unpaid")
    .reduce(
      (acc, leave) => acc + clampedLeaveDays(leave, startDate, endDate),
      0
    );

  return {
    employeeId: employee.id,
    periodMonth,
    periodYear,
    baseSalary: Number(salary.base_salary) || 0,
    fixedAllowance: Number(salary.fixed_allowance) || 0,
    variableAllowance: Number(salary.variable_allowance) || 0,
    transportAllowance: Number(salary.transport_allowance) || 0,
    mealAllowance: Number(salary.meal_allowance) || 0,
    housingAllowance: Number(salary.housing_allowance) || 0,
    overtimeHours,
    workingDays,
    presentDays,
    lateDays,
    lateMinutes,
    unpaidLeaveDays,
    joinDate: employee.join_date,
    employmentStatus: employee.employment_status,
    ptkpStatus: salary.ptkp_status || "TK/0",
    isTaxable: salary.is_taxable ?? true,
    bpjsTkEnrolled: salary.bpjs_tk_enrolled ?? true,
    bpjsKesEnrolled: salary.bpjs_kes_enrolled ?? true,
    taperaEnrolled: salary.tapera_enrolled ?? true,
    includeThr: options.includeThr ?? false,
    workingDaysSource,
  };
}

/**
 * Hitung payroll satu karyawan langsung dari database.
 */
export async function calculatePayrollForEmployee(
  employeeId: string,
  periodMonth: number,
  periodYear: number,
  config?: PayrollConfig
): Promise<PayrollResult | null> {
  const db = await createServerPgClient();

  const { data: employee } = await db
    .from("employees")
    .select("id, full_name, join_date, employment_status")
    .eq("id", employeeId)
    .maybeSingle();

  if (!employee) return null;

  const input = await loadEmployeePayrollInput(
    db,
    employee,
    periodMonth,
    periodYear
  );
  if (!input) return null;

  const resolvedConfig = config ?? (await loadPayrollConfig(db, periodYear));
  return calculatePayroll(input, resolvedConfig);
}
