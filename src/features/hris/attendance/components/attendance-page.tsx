"use client";

import { useEffect, useState } from "react";
import { AttendanceCalendar } from "@/components/hris/AttendanceCalendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Filter, Clock, Calendar, MapPin } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { exportAttendanceCsv } from "../api";

interface AttendanceStats {
  present_today: number;
  late_today: number;
  active_employees: number | null;
  month_late: number;
  avg_work_hours: number | null;
}

export function AttendancePage() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [filterEmployee, setFilterEmployee] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [refreshKey] = useState(0);
  const [stats, setStats] = useState<AttendanceStats | null>(null);

  useEffect(() => {
    fetch("/api/hris/attendance/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setStats(json?.data ?? null))
      .catch(() => {});
  }, []);

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };

  const handleExport = async () => {
    try {
      const blob = await exportAttendanceCsv({
        employee_id: filterEmployee,
        status: filterStatus,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export gagal: ' + (error as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Absensi & Timesheet</h1>
          <p className="text-sm text-gray-500 mt-1">Kelola absensi karyawan dengan GPS tracking</p>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={handleExport}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            <span className="hidden lg:inline">Export CSV</span>
            <span className="lg:hidden">CSV</span>
          </Button>
          <Button variant="outline" size="sm" className="sm:hidden">
            <Filter className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="sm">
            <Filter className="w-3.5 h-3.5 mr-1.5" />
            <span className="hidden lg:inline">Filter</span>
            <span className="lg:hidden">Filter</span>
          </Button>
        </div>
      </div>

      {/* Absen dilakukan karyawan via ESS (/dashboard/me/absensi) dengan
          selfie + GPS — halaman ini murni rekap & validasi utk HRD. */}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Filter className="w-4 h-4" />
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Karyawan
              </label>
              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger>
                  <SelectValue placeholder="Semua karyawan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Karyawan</SelectItem>
                  <SelectItem value="self">Saya Saja</SelectItem>
                  {/* Add more employee options dynamically */}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Status Absensi
              </label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Semua status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="present">Hadir</SelectItem>
                  <SelectItem value="late">Terlambat</SelectItem>
                  <SelectItem value="absent">Alpha</SelectItem>
                  <SelectItem value="half-day">Setengah Hari</SelectItem>
                  <SelectItem value="remote">Remote</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Bulan
              </label>
              <Select defaultValue={new Date().getMonth().toString()}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih bulan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Januari</SelectItem>
                  <SelectItem value="1">Februari</SelectItem>
                  <SelectItem value="2">Maret</SelectItem>
                  <SelectItem value="3">April</SelectItem>
                  <SelectItem value="4">Mei</SelectItem>
                  <SelectItem value="5">Juni</SelectItem>
                  <SelectItem value="6">Juli</SelectItem>
                  <SelectItem value="7">Agustus</SelectItem>
                  <SelectItem value="8">September</SelectItem>
                  <SelectItem value="9">Oktober</SelectItem>
                  <SelectItem value="10">November</SelectItem>
                  <SelectItem value="11">Desember</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar */}
      <AttendanceCalendar
        onDateSelect={handleDateSelect}
        refreshKey={refreshKey}
      />

      {/* Selected Date Info */}
      {selectedDate && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Detail: {selectedDate.toLocaleDateString("id-ID", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDate(null)}
              >
                Tutup
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">
              Klik tanggal di kalender untuk melihat detail absensi pada hari tersebut.
            </p>
            {/* Could add attendance list for selected date here */}
          </CardContent>
        </Card>
      )}

      {/* Quick Stats — data dari /api/hris/attendance/stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 rounded-full">
                <Clock className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Hadir Hari Ini</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats ? `${stats.present_today}${stats.active_employees ? `/${stats.active_employees}` : ""}` : "…"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-yellow-100 rounded-full">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Terlambat Hari Ini</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats ? stats.late_today : "…"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-red-100 rounded-full">
                <Clock className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Terlambat Bulan Ini</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats ? stats.month_late : "…"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-full">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Rata-rata Jam Kerja</p>
                <p className="text-2xl font-bold text-gray-900">
                  {stats ? (stats.avg_work_hours != null ? `${stats.avg_work_hours} jam` : "—") : "…"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
