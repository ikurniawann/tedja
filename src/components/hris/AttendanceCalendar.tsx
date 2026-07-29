"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import {
  resolveScheduleRowForDate,
  type EmployeeShiftRow,
} from "@/lib/hris/shifts";
import {
  holidaysOn,
  indexHolidays,
  type HolidayIndex,
  type HolidayRow,
} from "@/lib/hris/holidays";

interface AttendanceRecord {
  id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: number | null;
  status: string;
  is_late: boolean;
}

/** Baris pola jadwal + detail shift dari /api/hris/attendance/schedule. */
interface ScheduleRow extends EmployeeShiftRow {
  shift_name: string | null;
  start_time: string | null; // "HH:MM:SS"
  end_time: string | null;
  is_overnight: boolean | null;
}

interface AttendanceCalendarProps {
  employeeId?: string;
  initialDate?: Date;
  onDateSelect?: (date: Date) => void;
  /** naikkan nilainya untuk memaksa refetch (mis. setelah clock-in/out) */
  refreshKey?: number;
}

/**
 * Kunci tanggal WIB (YYYY-MM-DD). Kolom `date` Postgres di-serialize server
 * (TZ WIB) menjadi ISO UTC bergeser 17:00 hari sebelumnya — normalisasi di
 * zona Asia/Jakarta mengembalikannya ke tanggal kalender yang benar.
 */
function wibDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** YYYY-MM-DD dari komponen tanggal lokal (tanpa geser timezone). */
function localDateKey(year: number, monthIndex: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/** "08:00:00" → "08.00" */
function shiftTime(time: string | null): string {
  return time ? time.slice(0, 5).replace(":", ".") : "";
}

function clockTime(isoString: string | null): string {
  if (!isoString) return "–";
  return new Date(isoString).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

const WEEK_DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export function AttendanceCalendar({
  employeeId,
  initialDate = new Date(),
  onDateSelect,
  refreshKey = 0,
}: AttendanceCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date(initialDate));
  const [attendances, setAttendances] = useState<Record<string, AttendanceRecord>>({});
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [holidayIndex, setHolidayIndex] = useState<HolidayIndex>(() => indexHolidays([]));
  const [isLoading, setIsLoading] = useState(false);
  // Popup detail hari (terutama mobile — di layar kecil detail sel disembunyikan)
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const fetchAttendances = useCallback(async () => {
    setIsLoading(true);
    try {
      const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

      const params = new URLSearchParams({
        start_date: localDateKey(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()),
        end_date: localDateKey(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()),
        ...(employeeId ? { employee_id: employeeId } : {}),
        limit: "100",
      });

      const response = await fetch(`/api/hris/attendance?${params}`);
      const result = await response.json();

      if (result.data) {
        const attendanceMap: Record<string, AttendanceRecord> = {};
        result.data.forEach((att: AttendanceRecord) => {
          attendanceMap[wibDateKey(att.date)] = att;
        });
        setAttendances(attendanceMap);
      }
    } catch (error) {
      console.error("Error fetching attendances:", error);
    } finally {
      setIsLoading(false);
    }
  }, [currentMonth, employeeId]);

  useEffect(() => {
    void fetchAttendances();
  }, [fetchAttendances, refreshKey]);

  /**
   * Hari libur bulan tampak (EPIC-036). Endpoint mengembalikan holiday_date
   * sebagai teks "YYYY-MM-DD" sehingga tidak ada geseran timezone — kunci sel
   * kalender (localDateKey) langsung cocok. Gagal memuat tidak memblokir
   * kalender: tanggal merah hilang, jadwal & absensi tetap tampil.
   */
  useEffect(() => {
    const first = localDateKey(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const lastDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const last = localDateKey(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate());

    fetch(`/api/hris/holidays?start_date=${first}&end_date=${last}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setHolidayIndex(indexHolidays((json?.data ?? []) as HolidayRow[])))
      .catch(() => setHolidayIndex(indexHolidays([])));
  }, [currentMonth]);

  // pola jadwal shift — sekali per karyawan (pola mingguan, bukan per bulan)
  useEffect(() => {
    if (!employeeId) {
      setSchedule([]);
      return;
    }
    fetch(`/api/hris/attendance/schedule?employee_id=${employeeId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setSchedule((json?.data ?? []) as ScheduleRow[]))
      .catch(() => setSchedule([]));
  }, [employeeId]);

  const year = currentMonth.getFullYear();
  const monthIndex = currentMonth.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, monthIndex, 1).getDay();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

  const now = new Date();
  const todayKey = localDateKey(now.getFullYear(), now.getMonth(), now.getDate());

  const prevMonth = () => setCurrentMonth(new Date(year, monthIndex - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, monthIndex + 1, 1));
  const goToToday = () => setCurrentMonth(new Date());

  // Detail hari terpilih (untuk popup — terutama mobile)
  const selectedInfo = (() => {
    if (!selectedDate) return null;
    const attendance = attendances[selectedDate];
    const scheduleRow =
      schedule.length > 0 ? resolveScheduleRowForDate(schedule, selectedDate) : null;
    const isDayOff = scheduleRow !== null && scheduleRow.shift_id === null;
    const scheduledShift = scheduleRow && scheduleRow.shift_id ? scheduleRow : null;
    const label = new Date(`${selectedDate}T00:00:00`).toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const holidays = holidaysOn(holidayIndex, selectedDate);
    return { attendance, scheduledShift, isDayOff, label, holidays };
  })();

  const renderDay = (day: number, weekdayIndex: number) => {
    const dateStr = localDateKey(year, monthIndex, day);
    const isToday = dateStr === todayKey;
    const isSunday = weekdayIndex === 0;
    const attendance = attendances[dateStr];
    const scheduleRow = schedule.length > 0 ? resolveScheduleRowForDate(schedule, dateStr) : null;
    const isDayOff = scheduleRow !== null && scheduleRow.shift_id === null;
    const scheduledShift = scheduleRow && scheduleRow.shift_id ? scheduleRow : null;
    const isLate = attendance?.is_late ?? false;
    const holidays = holidaysOn(holidayIndex, dateStr);
    const isPublicHoliday = holidays.length > 0;

    return (
      <div
        key={day}
        onClick={() => {
          if (onDateSelect) {
            onDateSelect(new Date(year, monthIndex, day));
            return;
          }
          setSelectedDate(dateStr);
        }}
        className={`group relative flex min-h-16 sm:min-h-24 cursor-pointer flex-col gap-1 p-1.5 sm:p-2 transition-colors ${
          isToday
            ? "bg-blue-50/70"
            : isPublicHoliday
              ? "bg-red-50/60"
              : isDayOff
                ? "bg-gray-50/80"
                : "bg-white hover:bg-slate-50"
        }`}
      >
        {/* nomor tanggal */}
        <div className="flex items-start justify-between">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              isToday
                ? "bg-blue-600 text-white shadow-sm"
                : isPublicHoliday
                  ? "text-red-600"
                  : isSunday
                    ? "text-red-400"
                    : isDayOff
                      ? "text-gray-400"
                      : "text-gray-700"
            }`}
          >
            {day}
          </span>
          {/* dot ringkas utk layar kecil */}
          <span className="flex gap-1 sm:hidden">
            {isPublicHoliday && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
            {attendance && (
              <span
                className={`h-1.5 w-1.5 rounded-full ${isLate ? "bg-amber-500" : "bg-emerald-500"}`}
              />
            )}
            {scheduledShift && <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />}
          </span>
        </div>

        {/* hari libur — nama liburnya, bukan sekadar warna merah */}
        {isPublicHoliday && (
          <div className="hidden sm:block rounded-md border-l-2 border-red-400 bg-red-50 px-1.5 py-0.5">
            {holidays.map((holiday) => (
              <p
                key={holiday.name}
                title={holiday.name}
                className="truncate text-[10px] font-semibold leading-tight text-red-700"
              >
                {holiday.name}
              </p>
            ))}
          </div>
        )}

        {/* jadwal shift */}
        {scheduledShift && (
          <div className="hidden sm:block rounded-md border-l-2 border-indigo-400 bg-indigo-50/80 px-1.5 py-0.5">
            <p className="truncate text-[10px] font-semibold leading-tight text-indigo-700">
              {scheduledShift.shift_name}
            </p>
            <p className="text-[10px] leading-tight text-indigo-400">
              {shiftTime(scheduledShift.start_time)}–{shiftTime(scheduledShift.end_time)}
              {scheduledShift.is_overnight ? " +1" : ""}
            </p>
          </div>
        )}
        {isDayOff && (
          <p className="hidden sm:block text-[10px] font-medium uppercase tracking-wider text-gray-300">
            Libur
          </p>
        )}

        {/* realisasi absensi */}
        {attendance && (
          <div
            className={`hidden sm:block rounded-md border-l-2 px-1.5 py-0.5 ${
              isLate ? "border-amber-400 bg-amber-50" : "border-emerald-400 bg-emerald-50"
            }`}
          >
            <p
              className={`truncate text-[10px] font-semibold leading-tight ${
                isLate ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {clockTime(attendance.clock_in)}–{clockTime(attendance.clock_out)}
            </p>
            <p
              className={`text-[10px] leading-tight ${
                isLate ? "text-amber-500" : "text-emerald-500"
              }`}
            >
              {isLate
                ? "Terlambat"
                : attendance.work_hours
                  ? `${Number(attendance.work_hours).toFixed(1)} jam`
                  : "Hadir"}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-gray-400">
              <CalendarIcon className="h-3.5 w-3.5" /> Kalender Absensi
            </p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-gray-900">
              {currentMonth.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Bulan sebelumnya">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
              className="h-8 rounded-full px-3 text-xs"
            >
              Hari Ini
            </Button>
            <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Bulan berikutnya">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
          {/* header hari */}
          <div className="grid grid-cols-7 gap-px bg-gray-100">
            {WEEK_DAYS.map((day, i) => (
              <div
                key={day}
                className={`bg-gray-50 py-2 text-center text-[10px] font-semibold uppercase tracking-wider ${
                  i === 0 ? "text-red-400" : "text-gray-400"
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {isLoading ? (
            /* skeleton grid saat memuat */
            <div className="grid grid-cols-7 gap-px bg-gray-100">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="min-h-16 sm:min-h-24 animate-pulse bg-white p-2">
                  <div className="h-5 w-5 rounded-full bg-gray-100" />
                </div>
              ))}
            </div>
          ) : (
            <div key={`${year}-${monthIndex}`} className="grid grid-cols-7 gap-px bg-gray-100">
              {Array.from({ length: totalCells }).map((_, i) => {
                const day = i - firstDayOfMonth + 1;
                if (day < 1 || day > daysInMonth) {
                  return <div key={`pad-${i}`} className="min-h-16 sm:min-h-24 bg-gray-50/60" />;
                }
                return renderDay(day, i % 7);
              })}
            </div>
          )}
        </div>

        {/* legenda */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Hadir
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Terlambat
          </span>
          {holidayIndex.size > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Hari libur
            </span>
          )}
          {schedule.length > 0 && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-400" /> Jadwal shift
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-gray-300" /> Libur
              </span>
            </>
          )}
          <span className="ml-auto hidden text-gray-300 sm:inline">
            Waktu dalam WIB
          </span>
        </div>
        <p className="mt-2 text-[11px] text-gray-400 sm:hidden">
          Ketuk tanggal untuk melihat jadwal & jam absen.
        </p>
      </CardContent>

      {/* Popup detail hari — dipakai terutama di mobile */}
      <Dialog
        open={selectedInfo !== null}
        onOpenChange={(open) => !open && setSelectedDate(null)}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">{selectedInfo?.label}</DialogTitle>
          </DialogHeader>
          {selectedInfo && (
            <div className="space-y-3">
              {/* Hari libur */}
              {selectedInfo.holidays.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50/70 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-red-400">
                    Hari Libur
                  </p>
                  {selectedInfo.holidays.map((holiday) => (
                    <p key={holiday.name} className="mt-1 text-sm font-semibold text-red-700">
                      {holiday.name}
                      {holiday.deducts_leave && (
                        <span className="ml-1 text-xs font-normal text-red-400">
                          (memotong jatah cuti)
                        </span>
                      )}
                    </p>
                  ))}
                </div>
              )}

              {/* Jadwal shift */}
              <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-400">
                  Jadwal Shift
                </p>
                {selectedInfo.scheduledShift ? (
                  <p className="mt-1 text-sm font-semibold text-indigo-800">
                    {selectedInfo.scheduledShift.shift_name} ·{" "}
                    {shiftTime(selectedInfo.scheduledShift.start_time)}–
                    {shiftTime(selectedInfo.scheduledShift.end_time)}
                    {selectedInfo.scheduledShift.is_overnight ? " (+1 hari)" : ""}
                  </p>
                ) : selectedInfo.isDayOff ? (
                  <p className="mt-1 text-sm font-medium text-gray-500">Libur</p>
                ) : (
                  <p className="mt-1 text-sm text-gray-400">
                    {schedule.length > 0 ? "Tanpa jadwal" : "Jadwal belum diatur"}
                  </p>
                )}
              </div>

              {/* Realisasi absensi */}
              <div
                className={`rounded-lg border p-3 ${
                  selectedInfo.attendance
                    ? selectedInfo.attendance.is_late
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-emerald-200 bg-emerald-50/60"
                    : "border-gray-100 bg-gray-50/60"
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Absensi
                </p>
                {selectedInfo.attendance ? (
                  <div className="mt-1 space-y-0.5 text-sm">
                    <p className="font-semibold text-gray-800">
                      {clockTime(selectedInfo.attendance.clock_in)} –{" "}
                      {clockTime(selectedInfo.attendance.clock_out)}
                    </p>
                    <p
                      className={
                        selectedInfo.attendance.is_late
                          ? "text-amber-600"
                          : "text-emerald-600"
                      }
                    >
                      {selectedInfo.attendance.is_late ? "Terlambat" : "Tepat waktu"}
                      {selectedInfo.attendance.work_hours
                        ? ` · ${Number(selectedInfo.attendance.work_hours).toFixed(1)} jam kerja`
                        : ""}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-400">Belum ada catatan absen</p>
                )}
              </div>
              <p className="text-center text-[10px] text-gray-300">Waktu dalam WIB</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
