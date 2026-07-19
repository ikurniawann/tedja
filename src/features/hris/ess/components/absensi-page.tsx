"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { AttendanceCalendar } from "@/components/hris/AttendanceCalendar";
import { EssClockPanel } from "./ess-clock-panel";

/**
 * ESS → Absensi (/dashboard/me/absensi): shift hari ini, clock-in/out
 * dengan selfie + GPS, dan kalender absensi milik sendiri.
 */

interface MeData {
  employee: { id: string; full_name: string; position_title: string | null } | null;
  today_shift: {
    name: string;
    start_time: string | null;
    end_time: string | null;
    late_tolerance_minutes: number;
  } | null;
  has_schedule: boolean;
}

export function EssAbsensiPage() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendarKey, setCalendarKey] = useState(0);

  useEffect(() => {
    fetch("/api/hris/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setMe(json?.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!me?.employee) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-lg font-semibold text-gray-800">
          Akun ini tidak terhubung ke data karyawan
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Absensi hanya tersedia untuk akun yang tertaut ke record karyawan HRIS.
          Hubungi HRD bila menurut Anda ini keliru.
        </p>
      </div>
    );
  }

  const shift = me.today_shift;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200/70 bg-gradient-to-r from-green-50 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-gray-900">Absensi</h1>
          <p className="flex items-center gap-1.5 text-sm text-gray-600">
            <CalendarDaysIcon className="h-4 w-4 text-green-600" />
            {shift ? (
              <>
                Shift hari ini: <b>{shift.name}</b> · {shift.start_time?.slice(0, 5)}–
                {shift.end_time?.slice(0, 5)} · toleransi {shift.late_tolerance_minutes} mnt
              </>
            ) : me.has_schedule ? (
              <>Hari ini jadwal Anda <b>libur</b> — absen tetap bisa, tercatat di luar jadwal.</>
            ) : (
              <>Jadwal shift Anda belum diatur HRD — absen tercatat tanpa penilaian terlambat.</>
            )}
          </p>
        </div>
        <div className="mt-4">
          <EssClockPanel onChanged={() => setCalendarKey((key) => key + 1)} />
        </div>
      </div>

      <AttendanceCalendar employeeId="me" refreshKey={calendarKey} />
    </div>
  );
}
