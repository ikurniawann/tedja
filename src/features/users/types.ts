export type { UserEmployeeItem } from "@/lib/users/user-mapper";
export type { CreateUserEmployeeInput, UpdateUserEmployeeInput } from "@/lib/users/schemas";

import type { UserEmployeeItem } from "@/lib/users/user-mapper";
import type { UserRole } from "@/types";

export type AccountStatus = "active" | "inactive";

export interface ApprovalPermission {
  id?: string;
  module: string;
  workflow: string;
  approval_level: "checker" | "approver" | "final_approver";
  approval_limit: number | null;
  is_active: boolean;
}

export interface UserEmployeeFormValues {
  full_name: string;
  email: string;
  phone: string;
  join_date: string;
  employment_status: string;
  ktp: string;
  npwp: string;
  birth_date: string;
  gender: string;
  marital_status: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  department_id: string;
  section_id: string;
  job_title_id: string;
  reporting_to: string;
  bank_name: string;
  bank_account: string;
  bpjs_tk: string;
  bpjs_kesehatan: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  notes: string;
  nip: string;
  is_active: boolean;
  end_date: string;
  is_access_app: boolean;
  password: string;
  role: UserRole;
  business_scope: "" | "holding" | "company" | "branch";
  holding_id: string;
  company_id: string;
  branch_id: string;
  warehouse_ids: string[];
  default_warehouse_id: string;
  can_switch_stall: boolean;
  can_central_checkout: boolean;
  account_status: AccountStatus;
  approval_permissions: ApprovalPermission[];
}

export interface BrandOption {
  id: string;
  name: string;
}

export interface UserListParams {
  search?: string;
  department_id?: string;
  employment_status?: string;
  is_active?: string;
  is_access_app?: string;
  role?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}

export interface UserListResponse {
  data: UserEmployeeItem[];
  total: number;
  page: number;
  perPage: number;
}

export interface UserDirectoryStats {
  total: number;
  active: number;
  withAccess: number;
}

export interface UserFormLookups {
  departments: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string }>;
  positions: Array<{ id: string; title: string; department: string }>;
  managers: Array<{ id: string; full_name: string; nip: string }>;
  employmentStatuses: Array<{ code: string; name: string; is_active?: boolean }>;
}

export interface EmployeeDocumentInput {
  employee_id: string;
  document_type: string;
  document_name: string;
  file_url: string;
  issue_date?: string;
  expiry_date?: string;
  notes?: string;
}

export interface EmployeeDocumentRow {
  id: string;
  document_type: string;
  document_name: string;
  file_url: string;
  issue_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
  created_at?: string;
  is_verified?: boolean;
}

export interface EmploymentHistoryRow {
  id: string;
  change_type: string;
  effective_date: string;
  prev_department?: { name: string } | null;
  new_department?: { name: string } | null;
  prev_job_title?: { title: string } | null;
  new_job_title?: { title: string } | null;
  prev_employment_status?: string | null;
  new_employment_status?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export interface AttendanceRow {
  id: string;
  date: string;
  check_in?: string | null;
  check_out?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  status?: string | null;
  work_hours?: number | null;
  is_late?: boolean;
}

export interface LeaveBalanceRow {
  id: string;
  leave_type: string;
  leave_type_name?: string;
  total_days?: number;
  used_days?: number;
  remaining_days?: number;
  balance?: number;
  quota?: number;
  used?: number;
  year?: number;
}
