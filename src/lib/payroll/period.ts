/**
 * Logika murni periode payroll (EPIC-008 Fase B):
 * - hari kerja terjadwal dari pola shift (employee_shifts),
 * - klaim hari cuti di-clamp ke periode,
 * - realisasi jam lembur dari pengajuan approved yang dicocokkan absensi,
 * - statistik keterlambatan dari baris absensi.
 *
 * Tanpa akses DB — mudah diuji unit. Pemuatan data ada di inputs.ts.
 */

import {
  resolveShiftForDate,
  type EmployeeShiftRow,
} from "@/lib/hris/shifts";

export interface AttendancePeriodRow {
  date: string; // YYYY-MM-DD
  status: string;
  clock_out: string | null;
  is_late: boolean | null;
  late_minutes: number | null;
  overtime_hours: number | null;
}

export interface OvertimeRequestRow {
  date: string; // YYYY-MM-DD
  hours: number;
}

export interface LeaveRangeRow {
  start_date: string;
  end_date: string;
}

/** Daftar tanggal ISO inklusif [startIso..endIso]. */
export function eachDateOfPeriod(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Hari kerja terjadwal dalam periode menurut pola shift karyawan.
 * hasSchedule=false bila karyawan tidak punya pola sama sekali yang
 * menyentuh periode — pemanggil WAJIB menangani fallback secara eksplisit.
 */
export function countScheduledDays(
  scheduleRows: EmployeeShiftRow[],
  startIso: string,
  endIso: string
): { scheduledDays: number; hasSchedule: boolean } {
  if (scheduleRows.length === 0) {
    return { scheduledDays: 0, hasSchedule: false };
  }
  let scheduledDays = 0;
  for (const dateIso of eachDateOfPeriod(startIso, endIso)) {
    if (resolveShiftForDate(scheduleRows, dateIso)) scheduledDays += 1;
  }
  return { scheduledDays, hasSchedule: true };
}

/**
 * Jumlah hari sebuah rentang cuti yang jatuh DI DALAM periode (inklusif).
 * Cuti lintas bulan hanya dihitung porsinya di periode berjalan —
 * sebelumnya seluruh durasi terpotong di bulan pengajuan.
 */
export function clampedLeaveDays(
  leave: LeaveRangeRow,
  startIso: string,
  endIso: string
): number {
  const from = leave.start_date > startIso ? leave.start_date : startIso;
  const to = leave.end_date < endIso ? leave.end_date : endIso;
  if (from > to) return 0;
  const fromMs = new Date(`${from}T00:00:00Z`).getTime();
  const toMs = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((toMs - fromMs) / 86_400_000) + 1;
}

/**
 * Realisasi jam lembur: hanya pengajuan APPROVED yang terealisasi.
 * - Tidak ada absensi ber-clock_out pada tanggal itu → 0 jam (tidak bekerja).
 * - Absensi punya overtime_hours > 0 → min(pengajuan, aktual).
 * - Absensi ada tapi overtime_hours kosong/0 (belum dihitung sistem lama)
 *   → pakai jam pengajuan.
 */
export function realizedOvertimeHours(
  requests: OvertimeRequestRow[],
  attendanceRows: AttendancePeriodRow[]
): number {
  const byDate = new Map(attendanceRows.map((row) => [row.date, row]));
  let total = 0;
  for (const request of requests) {
    const att = byDate.get(request.date);
    if (!att || !att.clock_out) continue;
    const actual = Number(att.overtime_hours) || 0;
    total += actual > 0 ? Math.min(Number(request.hours), actual) : Number(request.hours);
  }
  return Math.round(total * 100) / 100;
}

/** Statistik keterlambatan dari baris absensi (sumber: absensi v2 shift). */
export function computeLateStats(attendanceRows: AttendancePeriodRow[]): {
  lateDays: number;
  lateMinutes: number;
} {
  let lateDays = 0;
  let lateMinutes = 0;
  for (const row of attendanceRows) {
    const isLate = row.is_late === true || row.status === "late";
    if (!isLate) continue;
    lateDays += 1;
    lateMinutes += Number(row.late_minutes) || 0;
  }
  return { lateDays, lateMinutes };
}

/**
 * Jam lembur dari jam mulai/selesai (mendukung lembur lewat tengah malam),
 * dibulatkan 2 desimal. Dipakai API pengajuan lembur.
 */
export function overtimeHoursFromTimes(
  startTime: string,
  endTime: string
): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let minutes = eh * 60 + (em || 0) - (sh * 60 + (sm || 0));
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}
