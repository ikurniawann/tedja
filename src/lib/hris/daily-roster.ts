import { scheduledWindow, type ShiftInfo } from "./shifts";

/**
 * Logika murni roster harian absensi — menurunkan status kehadiran per
 * karyawan dari kombinasi jadwal shift, record absensi, dan cuti approved.
 * Dipakai endpoint /api/hris/attendance/daily-roster (monitoring HRD).
 *
 * Konvensi status:
 * - Row absensi menang atas cuti (kalau tetap masuk saat cuti → hadir).
 * - "absen" (mangkir) hanya untuk tanggal yang sudah lewat; hari berjalan
 *   dan masa depan memakai "belum_absen".
 */

export type RosterStatus =
  | "hadir"
  | "terlambat"
  | "belum_absen"
  | "absen"
  | "cuti"
  | "libur"
  | "tanpa_jadwal";

export const ROSTER_STATUSES: RosterStatus[] = [
  "hadir",
  "terlambat",
  "belum_absen",
  "absen",
  "cuti",
  "libur",
  "tanpa_jadwal",
];

export interface RosterStatusInput {
  hasAttendance: boolean;
  isLate: boolean;
  onApprovedLeave: boolean;
  /** ada baris pola jadwal yang berlaku utk hari ini (termasuk hari libur) */
  hasSchedule: boolean;
  /** shift terjadwal; null = libur (bila hasSchedule) */
  shiftId: string | null;
  /** tanggal roster < hari ini (WIB) */
  isPastDate: boolean;
}

export function deriveRosterStatus(input: RosterStatusInput): RosterStatus {
  if (input.hasAttendance) return input.isLate ? "terlambat" : "hadir";
  if (input.onApprovedLeave) return "cuti";
  if (input.hasSchedule && input.shiftId) {
    return input.isPastDate ? "absen" : "belum_absen";
  }
  if (input.hasSchedule) return "libur";
  return "tanpa_jadwal";
}

type OverdueShift = Pick<
  ShiftInfo,
  "start_time" | "end_time" | "is_overnight" | "late_tolerance_minutes"
>;

/**
 * Karyawan "belum_absen" yang sudah melewati jam mulai shift + toleransi —
 * inilah yang perlu ditindaklanjuti HRD di hari berjalan.
 */
export function isOverdue(
  now: Date,
  dateIso: string,
  shift: OverdueShift | null,
  status: RosterStatus
): boolean {
  if (status !== "belum_absen" || !shift) return false;
  const { start } = scheduledWindow(dateIso, shift);
  return now.getTime() > start.getTime() + shift.late_tolerance_minutes * 60_000;
}
