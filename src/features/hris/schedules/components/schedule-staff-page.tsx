"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MagnifyingGlassIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CalendarDaysIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { useToast, ToastContainer } from "@/components/ui/toast";
import { useScheduleStaff, useStaffSchedules, useScheduleBrands } from "../queries";
import { useSaveStaffSchedule } from "../mutations";
import type { ScheduleStaffMember, StaffScheduleRow } from "../types";

const DAYS = [
  { label: "Minggu", value: 0 },
  { label: "Senin", value: 1 },
  { label: "Selasa", value: 2 },
  { label: "Rabu", value: 3 },
  { label: "Kamis", value: 4 },
  { label: "Jumat", value: 5 },
  { label: "Sabtu", value: 6 },
];

function formatTime(t: string | null): string {
  if (!t) return "-";
  return t.substring(0, 5);
}

export function ScheduleStaffPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { toasts, showToast, removeToast } = useToast();

  // Filters
  const [brandFilter, setBrandFilter] = useState("all");
  const [staffSearch, setStaffSearch] = useState("");

  // Dialogs
  const [scheduleDialog, setScheduleDialog] = useState<{ staff: ScheduleStaffMember; current: StaffScheduleRow[] } | null>(null);

  // Schedule form: one row per day
  const [scheduleForm, setScheduleForm] = useState<Record<number, {
    start_time: string;
    end_time: string;
    is_off: boolean;
  }>>({});

  const staffQuery = useScheduleStaff(brandFilter);
  const schedulesQuery = useStaffSchedules();
  const brandsQuery = useScheduleBrands();

  const staff = staffQuery.data ?? [];
  const schedules = schedulesQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const loading = staffQuery.isLoading || schedulesQuery.isLoading || brandsQuery.isLoading;

  const saveScheduleMutation = useSaveStaffSchedule();
  const saving = saveScheduleMutation.isPending;

  function reload() {
    staffQuery.refetch();
    schedulesQuery.refetch();
    brandsQuery.refetch();
  }

  function getStaffSchedules(staffId: string): StaffScheduleRow[] {
    return schedules.filter((s) => s.staff_id === staffId);
  }

  function openScheduleDialog(st: ScheduleStaffMember) {
    const current = getStaffSchedules(st.id);
    const form: Record<number, { start_time: string; end_time: string; is_off: boolean }> = {};

    DAYS.forEach((d) => {
      const existing = current.find((c) => c.day_of_week === d.value);
      if (existing) {
        form[d.value] = {
          start_time: existing.start_time || "09:00",
          end_time: existing.end_time || "17:00",
          is_off: existing.is_off,
        };
      } else {
        form[d.value] = { start_time: "09:00", end_time: "17:00", is_off: false };
      }
    });

    setScheduleForm(form);
    setScheduleDialog({ staff: st, current });
  }

  async function handleSaveSchedule() {
    if (!scheduleDialog) return;

    const workRows: StaffScheduleRow[] = DAYS
      .filter((d) => !scheduleForm[d.value].is_off)
      .map((d) => ({
        staff_id: scheduleDialog.staff.id,
        day_of_week: d.value,
        start_time: scheduleForm[d.value].start_time,
        end_time: scheduleForm[d.value].end_time,
        is_off: false,
      }));

    const offRows: StaffScheduleRow[] = DAYS
      .filter((d) => scheduleForm[d.value].is_off)
      .map((d) => ({
        staff_id: scheduleDialog.staff.id,
        day_of_week: d.value,
        start_time: "00:00",
        end_time: "00:00",
        is_off: true,
      }));

    try {
      await saveScheduleMutation.mutateAsync({
        staffId: scheduleDialog.staff.id,
        rows: [...workRows, ...offRows],
      });
      showToast("Jadwal berhasil disimpan");
      setScheduleDialog(null);
    } catch (err) {
      showToast("Gagal menyimpan jadwal: " + (err instanceof Error ? err.message : ""), "error");
    }
  }

  const filteredStaff = staff.filter((s) =>
    s.full_name.toLowerCase().includes(staffSearch.toLowerCase()) ||
    s.employee_code.toLowerCase().includes(staffSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <button onClick={() => router.push("/dashboard/employees")} className="hover:text-gray-900">
          Direktori Karyawan
        </button>
        <span>/</span>
        <span className="text-gray-900 font-medium">Schedules</span>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6 overflow-x-auto">
          <button
            onClick={() => router.push("/dashboard/employees")}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
              ${pathname === "/dashboard/employees" || pathname.startsWith("/dashboard/employees/")
                ? 'border-pink-500 text-pink-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            Semua Karyawan
          </button>
          <button
            onClick={() => router.push("/dashboard/hris/schedules")}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
              ${pathname === "/dashboard/hris/schedules"
                ? 'border-pink-500 text-pink-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            Schedules
          </button>
          <button
            onClick={() => router.push("/dashboard/hris/sections")}
            className={`
              whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
              ${pathname === "/dashboard/hris/sections"
                ? 'border-pink-500 text-pink-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            Sections
          </button>
        </nav>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule Staff</h1>
          <p className="text-gray-500 text-sm mt-1">
            Atur jadwal kerja staff per minggu
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={brandFilter} onValueChange={(v) => setBrandFilter(v ?? "all")}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Semua Outlet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Outlet</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Cari staff..."
            value={staffSearch}
            onChange={(e) => setStaffSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" onClick={reload}>Refresh</Button>
      </div>

      {/* Schedule Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left p-3 text-xs font-semibold text-gray-500 uppercase">Staff</th>
                  {DAYS.map((d) => (
                    <th key={d.value} className="text-center p-3 text-xs font-semibold text-gray-500 uppercase min-w-[100px]">
                      {d.label}
                    </th>
                  ))}
                  <th className="text-center p-3 text-xs font-semibold text-gray-500 uppercase">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      Memuat...
                    </td>
                  </tr>
                ) : filteredStaff.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-gray-400">
                      <CalendarDaysIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                      Tidak ada staff
                    </td>
                  </tr>
                ) : (
                  filteredStaff.map((s) => {
                    const staffSched = getStaffSchedules(s.id);
                    return (
                      <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="p-3">
                          <div className="font-medium text-gray-900">{s.full_name}</div>
                          <div className="text-xs text-gray-400">{s.employee_code} · {s.brands?.name}</div>
                        </td>
                        {DAYS.map((d) => {
                          const sched = staffSched.find((c) => c.day_of_week === d.value);
                          return (
                            <td key={d.value} className="text-center p-2">
                              {sched?.is_off ? (
                                <Badge className="bg-red-100 text-red-600 text-xs">Off</Badge>
                              ) : sched ? (
                                <Badge className="bg-blue-100 text-blue-700 text-xs">
                                  {formatTime(sched.start_time)}-{formatTime(sched.end_time)}
                                </Badge>
                              ) : (
                                <span className="text-xs text-gray-300">-</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="text-center p-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openScheduleDialog(s)}
                          >
                            Atur
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Schedule Dialog */}
      <Dialog
        open={scheduleDialog !== null}
        onOpenChange={(o) => !o && setScheduleDialog(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Atur Jadwal — {scheduleDialog?.staff.full_name}
            </DialogTitle>
            <p className="text-xs text-gray-500">
              {scheduleDialog?.staff.employee_code} · {scheduleDialog?.staff.brands?.name}
            </p>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto py-2">
            {DAYS.map((d) => (
              <div
                key={d.value}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  scheduleForm[d.value]?.is_off ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"
                }`}
              >
                <div className="w-20 text-sm font-medium text-gray-700">{d.label}</div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={scheduleForm[d.value]?.is_off || false}
                    onChange={(e) =>
                      setScheduleForm((prev) => ({
                        ...prev,
                        [d.value]: { ...prev[d.value], is_off: e.target.checked },
                      }))
                    }
                    className="rounded"
                  />
                  <span className="text-gray-600">Libur</span>
                </label>
                {!scheduleForm[d.value]?.is_off && (
                  <div className="flex items-center gap-2 ml-auto">
                    <Input
                      type="time"
                      className="w-28"
                      value={scheduleForm[d.value]?.start_time || "09:00"}
                      onChange={(e) =>
                        setScheduleForm((prev) => ({
                          ...prev,
                          [d.value]: { ...prev[d.value], start_time: e.target.value },
                        }))
                      }
                    />
                    <span className="text-gray-400">–</span>
                    <Input
                      type="time"
                      className="w-28"
                      value={scheduleForm[d.value]?.end_time || "17:00"}
                      onChange={(e) =>
                        setScheduleForm((prev) => ({
                          ...prev,
                          [d.value]: { ...prev[d.value], end_time: e.target.value },
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleDialog(null)}>Batal</Button>
            <Button onClick={handleSaveSchedule} disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan Jadwal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
