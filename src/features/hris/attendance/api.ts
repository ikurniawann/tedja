import type {
  AttendanceExportParams,
  AttendanceListParams,
  AttendanceListResponse,
  DailyRosterData,
} from "./types";

export async function exportAttendanceCsv(params: AttendanceExportParams): Promise<Blob> {
  const search = new URLSearchParams();
  if (params.employee_id && params.employee_id !== "all") {
    search.set("employee_id", params.employee_id);
  }
  if (params.status && params.status !== "all") {
    search.set("status", params.status);
  }
  if (params.start_date) search.set("start_date", params.start_date);
  if (params.end_date) search.set("end_date", params.end_date);

  const response = await fetch(`/api/hris/attendance/export?${search.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Export failed");
  }
  return response.blob();
}

export async function fetchDailyRoster(date?: string): Promise<DailyRosterData> {
  const search = new URLSearchParams();
  if (date) search.set("date", date);
  const response = await fetch(`/api/hris/attendance/daily-roster?${search.toString()}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || "Gagal memuat roster harian");
  }
  return json.data as DailyRosterData;
}

export async function fetchAttendanceList(
  params: AttendanceListParams
): Promise<AttendanceListResponse> {
  const search = new URLSearchParams();
  if (params.employee_id) search.set("employee_id", params.employee_id);
  if (params.start_date) search.set("start_date", params.start_date);
  if (params.end_date) search.set("end_date", params.end_date);
  if (params.is_late) search.set("is_late", "true");
  search.set("page", String(params.page ?? 1));
  search.set("limit", String(params.limit ?? 20));

  const response = await fetch(`/api/hris/attendance?${search.toString()}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || "Gagal memuat data absensi");
  }
  return json as AttendanceListResponse;
}

export interface EmployeeOption {
  id: string;
  full_name: string;
  nip?: string | null;
}

export async function fetchActiveEmployees(): Promise<EmployeeOption[]> {
  const response = await fetch(
    "/api/hris/employees?is_active=true&limit=500&sort_by=full_name&sort_order=asc"
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || "Gagal memuat daftar karyawan");
  }
  return (json.data ?? []) as EmployeeOption[];
}
