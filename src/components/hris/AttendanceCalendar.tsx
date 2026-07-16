"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, MapPin } from "lucide-react";
import { ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUS_COLORS } from "@/types/hris";

interface AttendanceRecord {
  id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  work_hours: number | null;
  status: string;
  is_late: boolean;
}

interface AttendanceCalendarProps {
  employeeId?: string;
  initialDate?: Date;
  onDateSelect?: (date: Date) => void;
  /** naikkan nilainya untuk memaksa refetch (mis. setelah clock-in/out) */
  refreshKey?: number;
}

export function AttendanceCalendar({
  employeeId,
  initialDate = new Date(),
  onDateSelect,
  refreshKey = 0,
}: AttendanceCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date(initialDate));
  const [attendances, setAttendances] = useState<Record<string, AttendanceRecord>>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchAttendances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth, employeeId, refreshKey]);

  const fetchAttendances = async () => {
    setIsLoading(true);
    try {
      const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

      const params = new URLSearchParams({
        start_date: startDate.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
        ...(employeeId ? { employee_id: employeeId } : {}),
        limit: "100",
      });

      const response = await fetch(`/api/hris/attendance?${params}`);
      const result = await response.json();

      if (result.data) {
        const attendanceMap: Record<string, AttendanceRecord> = {};
        result.data.forEach((att: AttendanceRecord) => {
          attendanceMap[att.date] = att;
        });
        setAttendances(attendanceMap);
      }
    } catch (error) {
      console.error("Error fetching attendances:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    
    return { daysInMonth, firstDayOfMonth };
  };

  const { daysInMonth, firstDayOfMonth } = getDaysInMonth(currentMonth);

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentMonth(new Date());
  };

  const handleDateClick = (day: number) => {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    onDateSelect?.(date);
  };

  const formatTime = (isoString: string | null) => {
    if (!isoString) return "--:--";
    return new Date(isoString).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderDay = (day: number | null, isToday: boolean = false) => {
    if (!day) return <div className="h-24 bg-gray-50" />;

    const dateStr = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day).toISOString().split("T")[0];
    const attendance = attendances[dateStr];
    const statusColor = attendance ? ATTENDANCE_STATUS_COLORS[attendance.status as keyof typeof ATTENDANCE_STATUS_COLORS] : "";

    return (
      <div
        key={day}
        onClick={() => handleDateClick(day)}
        className={`h-24 border p-2 cursor-pointer hover:bg-gray-50 transition-colors ${
          isToday ? "bg-blue-50 border-blue-300" : "bg-white"
        }`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className={`text-sm font-medium ${isToday ? "text-blue-600" : "text-gray-900"}`}>
            {day}
          </span>
          {attendance && (
            <Badge variant="outline" className={`text-xs ${statusColor}`}>
              {ATTENDANCE_STATUS_LABELS[attendance.status as keyof typeof ATTENDANCE_STATUS_LABELS]}
            </Badge>
          )}
        </div>

        {attendance ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <Clock className="w-3 h-3" />
              <span>{formatTime(attendance.clock_in)}</span>
              <span>-</span>
              <span>{formatTime(attendance.clock_out)}</span>
            </div>
            {attendance.work_hours && (
              <div className="text-xs text-gray-500">
                {attendance.work_hours.toFixed(2)} jam
              </div>
            )}
            {attendance.is_late && (
              <Badge variant="destructive" className="text-xs">
                Terlambat
              </Badge>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-400 mt-2">Tidak ada absensi</div>
        )}
      </div>
    );
  };

  const weekDays = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const today = new Date().getDate();
  const isCurrentMonth = new Date().getMonth() === currentMonth.getMonth() && 
                         new Date().getFullYear() === currentMonth.getFullYear();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5" />
            Kalender Absensi
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={prevMonth}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday}>
              Hari Ini
            </Button>
            <Button variant="outline" size="sm" onClick={nextMonth}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-2">
          {currentMonth.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-px">
            {/* Week day headers */}
            {weekDays.map((day) => (
              <div key={day} className="bg-gray-100 p-2 text-center text-sm font-medium text-gray-700">
                {day}
              </div>
            ))}

            {/* Empty cells for days before the first day of the month */}
            {Array.from({ length: firstDayOfMonth }).map((_, i) => (
              <div key={`empty-${i}`} className="h-24 bg-gray-50" />
            ))}

            {/* Days of the month */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const isToday = isCurrentMonth && day === today;
              return renderDay(day, isToday);
            })}

            {/* Fill remaining cells to complete the grid */}
            {Array.from({ length: (42 - (firstDayOfMonth + daysInMonth)) % 7 }).map((_, i) => (
              <div key={`empty-end-${i}`} className="h-24 bg-gray-50" />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 pt-4 border-t flex flex-wrap gap-4">
          {Object.entries(ATTENDANCE_STATUS_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <Badge variant="outline" className={ATTENDANCE_STATUS_COLORS[key as keyof typeof ATTENDANCE_STATUS_COLORS]}>
                {label}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
