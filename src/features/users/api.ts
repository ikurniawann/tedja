import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api-client";
import type { CreateUserEmployeeInput, UpdateUserEmployeeInput } from "@/lib/users/schemas";
import type { UserEmployeeItem } from "@/lib/users/user-mapper";
import type { Employee } from "@/types/hris";
import type {
  AttendanceRow,
  EmployeeDocumentInput,
  EmployeeDocumentRow,
  EmploymentHistoryRow,
  LeaveBalanceRow,
  UserDirectoryStats,
  UserFormLookups,
  UserListParams,
  UserListResponse,
} from "./types";

export type BranchStallOption = {
  id: string;
  name: string;
  code: string;
  branch_id: string;
  is_default: boolean;
};

const BASE = "/api/users";

function buildListUrl(params?: UserListParams) {
  if (!params) return BASE;
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `${BASE}?${query}` : BASE;
}

export const fetchUserList = (params?: UserListParams) =>
  apiGet<UserListResponse>(buildListUrl(params));

export const fetchUserDetail = (id: string) =>
  apiGet<{ data: UserEmployeeItem }>(`${BASE}/${id}`);

export const fetchUserDirectoryStats = async (): Promise<UserDirectoryStats> => {
  const [all, active, withAccess] = await Promise.all([
    fetchUserList({ limit: 1, page: 1 }),
    fetchUserList({ limit: 1, page: 1, is_active: "true" }),
    fetchUserList({ limit: 1, page: 1, is_access_app: "true" }),
  ]);
  return {
    total: all.total,
    active: active.total,
    withAccess: withAccess.total,
  };
};

export const fetchHRISEmployeeDetail = (id: string) =>
  apiGet<{ data: Employee }>(`/api/hris/employees/${id}`);

export const fetchEmployeeDocuments = (employeeId: string) =>
  apiGet<{ data: EmployeeDocumentRow[] }>(`/api/hris/employees/documents?employee_id=${employeeId}`);

export const fetchEmploymentHistory = (employeeId: string) =>
  apiGet<{ data: EmploymentHistoryRow[] }>(`/api/hris/employment-history?employee_id=${employeeId}`);

export const fetchEmployeeAttendance = (employeeId: string, month: number, year: number) => {
  const params = new URLSearchParams({
    employee_id: employeeId,
    month: String(month),
    year: String(year),
  });
  return apiGet<{ data: AttendanceRow[] }>(`/api/hris/attendance?${params}`);
};

export const fetchEmployeeLeaveBalances = (employeeId: string) =>
  apiGet<{ data: LeaveBalanceRow[] }>(`/api/hris/leave-balances/${employeeId}`);

export const createEmployeeDocument = (payload: EmployeeDocumentInput) =>
  apiPost<{ data: unknown }>("/api/hris/employees/documents", payload);

export const deleteEmployeeDocument = (docId: string) =>
  apiDelete(`/api/hris/employees/documents/${docId}`);

export const fetchUserFormLookups = async (): Promise<UserFormLookups> => {
  const [deptsRes, posRes, statusRes, managersRes, sectionsRes] = await Promise.all([
    apiGet<{ data: UserFormLookups["departments"] }>("/api/master/departments"),
    apiGet<{ data: UserFormLookups["positions"] }>("/api/master/positions"),
    apiGet<{ data: UserFormLookups["employmentStatuses"] }>("/api/master/employment-statuses"),
    apiGet<{ data: UserFormLookups["managers"] }>(
      "/api/hris/employees?is_active=true&limit=200&sort_by=full_name&sort_order=asc"
    ),
    apiGet<{ data: UserFormLookups["sections"] }>("/api/sections"),
  ]);

  return {
    departments: deptsRes.data ?? [],
    positions: posRes.data ?? [],
    employmentStatuses: (statusRes.data ?? []).filter((s) => s.is_active !== false),
    managers: managersRes.data ?? [],
    sections: (sectionsRes.data ?? []).map((s) => ({ id: s.id, name: s.name })),
  };
};

export const createUser = (body: CreateUserEmployeeInput) =>
  apiPost<{ data: UserEmployeeItem; message: string }>(BASE, body);

export const updateUser = (id: string, body: UpdateUserEmployeeInput) =>
  apiPut<{ data: UserEmployeeItem; message: string }>(`${BASE}/${id}`, body);

export const resetUserPassword = (id: string) =>
  apiPost<{ message: string; tempPassword: string }>(`${BASE}/${id}/reset-password`, {});

export const fetchBranchStalls = async (branchId: string): Promise<BranchStallOption[]> => {
  const params = new URLSearchParams({ branch_id: branchId });
  const res = await fetch(`/api/purchasing/warehouses?${params.toString()}`);
  const json = (await res.json()) as { success?: boolean; data?: BranchStallOption[]; error?: string };
  if (!res.ok) {
    throw new Error(json.error ?? "Failed to load stalls");
  }
  return json.data ?? [];
};
