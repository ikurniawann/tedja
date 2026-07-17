/**
 * Payroll Input Loader
 *
 * Satu-satunya tempat pemuatan data karyawan untuk kalkulasi payroll —
 * dipakai baik oleh batch calculate (semua karyawan dalam satu run)
 * maupun perhitungan per-karyawan. Sebelumnya logika ini terduplikasi
 * di route calculate dan calculator.ts.
 */

import { createServerPgClient } from "@/lib/pg/create-client";
import {
  calculatePayroll,
  type PayrollInput,
  type PayrollResult,
} from "./calculator";
import { loadPayrollConfig, type PayrollConfig } from "./config";

type PgClient = Awaited<ReturnType<typeof createServerPgClient>>;

export interface EmployeeRow {
  id: string;
  full_name: string;
  join_date: string;
  employment_status: string;
}

const FALLBACK_WORKING_DAYS = 20;

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
 *
 * TODO(EPIC-008 Fase B): working days dari pola shift (employee_shifts),
 * lembur dari pengajuan approved, potongan telat dari late_minutes.
 */
export async function loadEmployeePayrollInput(
  db: PgClient,
  employee: EmployeeRow,
  periodMonth: number,
  periodYear: number,
  options: { includeThr?: boolean } = {}
): Promise<PayrollInput | null> {
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

  const { data: attendance } = await db
    .from("attendance")
    .select("date, work_hours, status")
    .gte("date", startDate)
    .lte("date", endDate)
    .eq("employee_id", employee.id);

  const attendanceRows: { date: string; work_hours: number | null; status: string }[] =
    attendance ?? [];
  const workingDays =
    attendanceRows.filter((d) => d.status !== "absent").length ||
    FALLBACK_WORKING_DAYS;
  const presentDays = attendanceRows.filter(
    (d) => d.status === "present" || d.status === "late"
  ).length;
  const lateDays = attendanceRows.filter((d) => d.status === "late").length;

  const { data: leaves } = await db
    .from("leaves")
    .select("start_date, end_date")
    .eq("employee_id", employee.id)
    .eq("leave_type", "unpaid")
    .eq("status", "approved")
    .gte("start_date", startDate)
    .lte("start_date", endDate);

  const leaveRows: { start_date: string; end_date: string }[] = leaves ?? [];
  const unpaidLeaveDays = leaveRows.reduce((acc, leave) => {
    const start = new Date(leave.start_date);
    const end = new Date(leave.end_date);
    const days =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return acc + days;
  }, 0);

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
    workingDays,
    presentDays,
    lateDays,
    unpaidLeaveDays,
    joinDate: employee.join_date,
    employmentStatus: employee.employment_status,
    ptkpStatus: salary.ptkp_status || "TK/0",
    isTaxable: salary.is_taxable ?? true,
    bpjsTkEnrolled: salary.bpjs_tk_enrolled ?? true,
    bpjsKesEnrolled: salary.bpjs_kes_enrolled ?? true,
    taperaEnrolled: salary.tapera_enrolled ?? true,
    includeThr: options.includeThr ?? false,
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
