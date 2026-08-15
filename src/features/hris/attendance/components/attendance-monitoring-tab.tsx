"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CalendarOff, Camera, Clock, RefreshCw, Users } from "lucide-react";
import { LEAVE_TYPE_LABELS } from "@/types/hris";
import { fetchDailyRoster } from "../api";
import type { DailyRosterData, RosterEmployee, RosterStatus } from "../types";

/**
 * Tab "Monitoring" absensi HRD — roster satu hari: siapa sudah/belum absen
 * per shift, plus cuti/libur/tanpa jadwal. Karyawan terjadwal yang melewati
 * jam mulai + toleransi tanpa clock-in ditonjolkan (is_overdue).
 */

const STATUS_META: Record<RosterStatus, { label: string; className: string }> = {
  hadir: { label: "Hadir", className: "bg-green-100 text-green-700" },
  terlambat: { label: "Terlambat", className: "bg-yellow-100 text-yellow-700" },
  belum_absen: { label: "Belum Absen", className: "bg-gray-100 text-gray-600" },
  absen: { label: "Tidak Hadir", className: "bg-red-100 text-red-700" },
  cuti: { label: "Cuti/Izin", className: "bg-blue-100 text-blue-700" },
  libur_nasional: { label: "Libur Nasional", className: "bg-red-100 text-red-600" },
  libur: { label: "Libur", className: "bg-slate-100 text-slate-500" },
  tanpa_jadwal: { label: "Tanpa Jadwal", className: "bg-orange-100 text-orange-700" },
};

function todayWib(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().split("T")[0];
}

function formatTimeWib(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

/** "08:00:00" → "08.00" utk header shift. */
function formatShiftTime(time: string): string {
  return time.slice(0, 5).replace(":", ".");
}

function SelfieLink({ path, label }: { path: string | null; label: string }) {
  if (!path) return null;
  return (
    <button
      onClick={() => window.open(`/api/hris/attendance/photo/${path}`, "_blank")}
      className="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline"
      title={`Lihat selfie ${label}`}
    >
      <Camera className="w-3 h-3" /> {label}
    </button>
  );
}

function RosterRow({ emp, isToday }: { emp: RosterEmployee; isToday: boolean }) {
  const meta = STATUS_META[emp.status];
  const overdue = emp.is_overdue && isToday;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${
        overdue ? "border-red-300 bg-red-50" : "border-gray-100 bg-white"
      }`}
    >
      {emp.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={emp.photo_url}
          alt={emp.full_name}
          className="w-9 h-9 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
          {emp.full_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{emp.full_name}</p>
        <p className="truncate text-xs text-gray-500">
          {[emp.nip, emp.department_name, emp.job_title].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      {emp.attendance ? (
        <div className="text-right text-xs text-gray-600">
          <p>
            Masuk <span className="font-medium">{formatTimeWib(emp.attendance.clock_in)}</span>
            {emp.attendance.is_late && (
              <span className="ml-1 text-yellow-700">(+{emp.attendance.late_minutes} mnt)</span>
            )}
          </p>
          <p>
            Pulang <span className="font-medium">{formatTimeWib(emp.attendance.clock_out)}</span>
          </p>
          <div className="mt-0.5 flex justify-end gap-2">
            <SelfieLink path={emp.attendance.clock_in_photo_url} label="masuk" />
            <SelfieLink path={emp.attendance.clock_out_photo_url} label="pulang" />
          </div>
        </div>
      ) : emp.leave ? (
        <p className="text-xs text-gray-500">
          {(emp.leave.leave_type &&
            LEAVE_TYPE_LABELS[emp.leave.leave_type as keyof typeof LEAVE_TYPE_LABELS]) ||
            "Cuti"}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5 shrink-0">
        {overdue && (
          <Badge className="bg-red-100 text-red-700">
            <AlertTriangle className="w-3 h-3" /> Lewat toleransi
          </Badge>
        )}
        <Badge className={meta.className}>{meta.label}</Badge>
      </div>
    </div>
  );
}

export function AttendanceMonitoringTab() {
  const [date, setDate] = useState(todayWib);
  const [data, setData] = useState<DailyRosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | RosterStatus>("all");
  const [filterShift, setFilterShift] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async (targetDate: string) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDailyRoster(targetDate));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat roster");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.employees.filter((emp) => {
      if (filterStatus !== "all" && emp.status !== filterStatus) return false;
      if (filterShift === "off" && emp.shift !== null) return false;
      if (filterShift !== "all" && filterShift !== "off" && emp.shift?.id !== filterShift)
        return false;
      if (term && !`${emp.full_name} ${emp.nip ?? ""}`.toLowerCase().includes(term))
        return false;
      return true;
    });
  }, [data, filterStatus, filterShift, search]);

  const groups = useMemo(() => {
    if (!data) return [];
    const byShift = data.shifts.map((shift) => ({
      key: shift.id,
      title: `${shift.name} (${formatShiftTime(shift.start_time)}–${formatShiftTime(shift.end_time)}${shift.is_overnight ? " +1 hari" : ""})`,
      employees: filtered.filter((emp) => emp.shift?.id === shift.id),
    }));
    const offSchedule = {
      key: "off",
      title: "Tanpa Shift Terjadwal (libur / cuti / di luar jadwal)",
      employees: filtered.filter((emp) => emp.shift === null),
    };
    return [...byShift, offSchedule].filter((group) => group.employees.length > 0);
  }, [data, filtered]);

  const summaryChips: { status: RosterStatus; count: number }[] = useMemo(() => {
    if (!data) return [];
    return (Object.keys(STATUS_META) as RosterStatus[])
      .map((status) => ({ status, count: data.summary[status] ?? 0 }))
      .filter(
        (chip) =>
          chip.count > 0 || ["hadir", "terlambat", "belum_absen"].includes(chip.status)
      )
      .filter((chip) => (data.is_today ? chip.status !== "absen" : chip.status !== "belum_absen"));
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Kontrol: tanggal + filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Tanggal</label>
              <div className="flex gap-2">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void load(date)}
                  title="Muat ulang"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Shift</label>
              <Select value={filterShift} onValueChange={setFilterShift}>
                <SelectTrigger>
                  <SelectValue placeholder="Semua shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Shift</SelectItem>
                  {(data?.shifts ?? []).map((shift) => (
                    <SelectItem key={shift.id} value={shift.id}>
                      {shift.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="off">Tanpa Shift</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Status</label>
              <Select
                value={filterStatus}
                onValueChange={(value) => setFilterStatus(value as "all" | RosterStatus)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Semua status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  {(Object.keys(STATUS_META) as RosterStatus[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_META[status].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Cari</label>
              <Input
                placeholder="Nama / NIP…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hari libur — jelaskan kenapa roster hari ini sepi (EPIC-036) */}
      {data && data.holidays.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <CalendarOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-semibold">
              {data.holidays.map((holiday) => holiday.name).join(" · ")}
            </span>{" "}
            — hari libur, karyawan terjadwal tidak dihitung mangkir.
          </p>
        </div>
      )}

      {/* Ringkasan */}
      {data && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-indigo-100 text-indigo-700">
            <Users className="w-3 h-3" /> Terjadwal {data.summary.scheduled}
          </Badge>
          {summaryChips.map(({ status, count }) => (
            <button
              key={status}
              onClick={() => setFilterStatus(filterStatus === status ? "all" : status)}
              className={`rounded-full transition-opacity ${
                filterStatus !== "all" && filterStatus !== status ? "opacity-40" : ""
              }`}
              title={`Filter ${STATUS_META[status].label}`}
            >
              <Badge className={STATUS_META[status].className}>
                {STATUS_META[status].label} {count}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {/* Isi roster */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-12 text-center text-red-500 text-sm">{error}</CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Clock className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            Tidak ada data yang cocok dengan filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">{group.title}</h3>
                <span className="text-xs text-gray-400">{group.employees.length} karyawan</span>
              </div>
              <div className="space-y-2">
                {group.employees.map((emp) => (
                  <RosterRow
                    key={emp.employee_id}
                    emp={emp}
                    isToday={data?.is_today ?? false}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
