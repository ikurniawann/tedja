"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BuildingOfficeIcon,
  PlusIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { Filter, Search, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ToastContainer, useToast } from "@/components/ui/toast";
import { filterComboboxClassName } from "@/components/layout/form-field";
import { useDepartmentList } from "@/features/master-data/departments";
import { PurchasingListSection } from "@/modules/purchasing/components/list/PurchasingListSection";
import { PurchasingTablePagination } from "@/modules/purchasing/components/pagination/PurchasingTablePagination";
import { useAuth } from "@/hooks/use-auth";
import { impersonateUser } from "../api";
import { useUserDirectoryStats, useUserList } from "../queries";
import {
  ADMIN_USER_ROLES,
  EMPLOYEES_ROUTES,
  ROLE_LABELS,
  STATUS_LABELS,
} from "../constants";
import { ContractExpiryBanner } from "./contract-expiry-banner";
import { ResetPasswordDialog, type ResetPasswordTarget } from "./reset-password-dialog";
import { CreateAccountDialog } from "./create-account-dialog";
import { UsersTable } from "./users-table";
import type { UserEmployeeItem } from "@/lib/users/user-mapper";

interface UsersListPageProps {
  /**
   * "directory" — menu Karyawan (/dashboard/employees): direktori karyawan HRIS.
   * "accounts" — menu Manajemen User (/dashboard/settings/users): akun login,
   * role, dan akses aplikasi (reset password, buat akun).
   */
  variant?: "directory" | "accounts";
}

export function UsersListPage({ variant = "directory" }: UsersListPageProps) {
  const isAccountsView = variant === "accounts";
  const showAppActions = isAccountsView;
  const router = useRouter();
  const pathname = usePathname();
  const { toasts, showToast, removeToast } = useToast();
  const { user } = useAuth();
  const canResetPassword = user?.role === "super_admin" || user?.role === "admin";
  // pembuatan akun login oleh Super Admin / Admin / HRD (selaras PUT /api/users)
  const canCreateAccount =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "hrd";
  // Login As hanya untuk super_admin di halaman /dashboard/employees
  const canLoginAs = !isAccountsView && user?.role === "super_admin";

  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [accessFilter, setAccessFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [resetTarget, setResetTarget] = useState<ResetPasswordTarget | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [createAccountTarget, setCreateAccountTarget] = useState<UserEmployeeItem | null>(null);
  const [loginAsEmployeeId, setLoginAsEmployeeId] = useState<string | null>(null);

  const perPage = 15;

  const listParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      department_id: departmentFilter !== "all" ? departmentFilter : undefined,
      employment_status: statusFilter !== "all" ? statusFilter : undefined,
      is_active: activeFilter !== "all" ? activeFilter : undefined,
      is_access_app: accessFilter !== "all" ? accessFilter : undefined,
      role: roleFilter || undefined,
      page,
      limit: perPage,
      sort_by: "full_name",
      sort_order: "asc" as const,
    }),
    [search, departmentFilter, statusFilter, activeFilter, accessFilter, roleFilter, page]
  );

  const { data, isLoading, isError } = useUserList(listParams);
  const { data: departments = [] } = useDepartmentList();
  const { data: stats = { total: 0, active: 0, withAccess: 0 } } = useUserDirectoryStats();
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const activeFilterCount = [
    departmentFilter !== "all",
    statusFilter !== "all",
    activeFilter !== "all",
    accessFilter !== "all",
    !!roleFilter,
  ].filter(Boolean).length;

  const isFilterActive = activeFilterCount > 0;

  const departmentFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Departments" },
      ...departments.map((d) => ({ value: d.id, label: d.name })),
    ],
    [departments]
  );
  const statusFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Statuses" },
      ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
    ],
    []
  );
  const activeFilterOptions = useMemo(
    () => [
      { value: "all", label: "All" },
      { value: "true", label: "Active" },
      { value: "false", label: "Inactive" },
    ],
    []
  );
  const accessFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Access" },
      { value: "true", label: "With App Access" },
      { value: "false", label: "Without App Access" },
    ],
    []
  );
  const roleFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Roles" },
      ...ADMIN_USER_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    ],
    []
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [departmentFilter, statusFilter, activeFilter, accessFilter, roleFilter]);

  function handleResetFilters() {
    setSearchQuery("");
    setSearch("");
    setDepartmentFilter("all");
    setStatusFilter("all");
    setActiveFilter("all");
    setAccessFilter("all");
    setRoleFilter("");
    setPage(1);
  }

  function handleResetPassword(row: UserEmployeeItem) {
    setResetTarget({ id: row.id, fullName: row.fullName });
    setResetDialogOpen(true);
  }

  async function handleLoginAs(row: UserEmployeeItem) {
    if (!row.userId || loginAsEmployeeId) return;
    setLoginAsEmployeeId(row.id);
    try {
      const result = await impersonateUser(row.userId);
      showToast(result.message || `Logged in as ${row.fullName}`);
      // Full reload agar seluruh state (session, layout, menu) mengikuti user baru.
      window.location.href =
        result.data.role === "super_admin" ? "/arkiv-os" : "/dashboard/me";
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to login as user", "error");
      setLoginAsEmployeeId(null);
    }
  }

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200/70 pb-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isAccountsView ? "Manajemen User" : "Karyawan"}
          </h1>
          <p className="text-sm text-gray-500">
            {isAccountsView
              ? "Kelola akun login, role, dan akses aplikasi"
              : "Direktori karyawan HRIS"}{" "}
            — {total} total
          </p>
        </div>
        {!isAccountsView && (
          <Link href={EMPLOYEES_ROUTES.insert}>
            <Button className="h-10 w-full gap-2 rounded-lg bg-pink-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-pink-700 sm:w-auto">
              <PlusIcon className="h-4 w-4" />
              Add Employee
            </Button>
          </Link>
        )}
      </div>

      {!isAccountsView && <ContractExpiryBanner />}

      {!isAccountsView && (
        <div className="border-b border-gray-200/70">
          <nav className="-mb-px flex space-x-6 overflow-x-auto">
            {[
              { href: EMPLOYEES_ROUTES.list, label: "All Employees" },
              { href: "/dashboard/hris/schedules", label: "Schedules" },
              { href: "/dashboard/hris/sections", label: "Sections" },
            ].map((tab) => (
              <button
                key={tab.href}
                type="button"
                onClick={() => router.push(tab.href)}
                className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium transition-colors ${
                  pathname === tab.href
                    ? "border-pink-500 text-pink-600"
                    : "border-transparent text-gray-500 hover:border-gray-200 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Employees", value: stats.total, icon: UserGroupIcon },
          { label: "Active", value: stats.active, icon: UserGroupIcon },
          { label: "App Access", value: stats.withAccess, icon: UserGroupIcon },
          { label: "Departments", value: departments.length, icon: BuildingOfficeIcon },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-gray-200/70 bg-white px-4 py-3 shadow-sm"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
              <item.icon className="h-3.5 w-3.5 text-pink-500" />
              {item.label}
            </div>
            <p className="mt-1 text-2xl font-bold text-gray-900">{item.value}</p>
          </div>
        ))}
      </div>

      <PurchasingListSection
        icon={Users}
        title={isAccountsView ? "Daftar User" : "Employee List"}
        description={
          isAccountsView
            ? "Akun login karyawan, role, dan status akses aplikasi."
            : "Track employee records and employment status."
        }
        toolbar={
          <div className="flex w-full flex-col gap-3 sm:w-auto md:flex-row md:items-center">
            <label className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search name, employee ID, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 bg-white pl-10 pr-10 text-sm focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => setFilterOpen((open) => !open)}
              className={
                isFilterActive
                  ? "h-10 gap-2 rounded-lg border-pink-600 bg-pink-600 px-3 text-sm font-semibold !text-white shadow-sm hover:!border-pink-700 hover:!bg-pink-700 hover:!text-white [&_*]:!text-white [&_svg]:!text-white"
                  : "h-10 gap-2 rounded-lg border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:!border-pink-200 hover:!bg-pink-50 hover:!text-pink-700"
              }
            >
              <Filter className="h-4 w-4" />
              Filter
              {isFilterActive ? (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>

            {(search || isFilterActive || page > 1) && (
              <Button
                variant="outline"
                onClick={handleResetFilters}
                className="h-10 flex-shrink-0 rounded-lg border-gray-200/80"
              >
                Reset
              </Button>
            )}
          </div>
        }
      >
        {filterOpen ? (
          <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Department
                </p>
                <Combobox
                  options={departmentFilterOptions}
                  value={departmentFilter}
                  onChange={setDepartmentFilter}
                  placeholder="Department"
                  searchPlaceholder="Search department..."
                  emptyMessage="No department found"
                  className={filterComboboxClassName}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</p>
                <Combobox
                  options={statusFilterOptions}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  placeholder="Status"
                  searchPlaceholder="Search status..."
                  emptyMessage="No status found"
                  className={filterComboboxClassName}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Activity
                </p>
                <Combobox
                  options={activeFilterOptions}
                  value={activeFilter}
                  onChange={setActiveFilter}
                  placeholder="Active"
                  searchPlaceholder="Search..."
                  emptyMessage="Not found"
                  className={filterComboboxClassName}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  App Access
                </p>
                <Combobox
                  options={accessFilterOptions}
                  value={accessFilter}
                  onChange={setAccessFilter}
                  placeholder="App Access"
                  searchPlaceholder="Search..."
                  emptyMessage="Not found"
                  className={filterComboboxClassName}
                />
              </div>
              {showAppActions ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Role</p>
                  <Combobox
                    options={roleFilterOptions}
                    value={roleFilter || "all"}
                    onChange={(value) => setRoleFilter(value === "all" ? "" : value)}
                    placeholder="Role"
                    searchPlaceholder="Search role..."
                    emptyMessage="No role found"
                    className={filterComboboxClassName}
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="py-14 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-pink-500" />
            <p className="mt-2 text-sm text-gray-500">Loading employees...</p>
          </div>
        ) : isError ? (
          <p className="py-14 text-center text-sm text-gray-500">Failed to load employees</p>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <Users className="mx-auto mb-4 h-12 w-12 text-gray-300" />
            <p className="text-gray-500">No employees found</p>
            <Link href={EMPLOYEES_ROUTES.insert}>
              <Button
                variant="outline"
                className="mt-4 h-10 gap-2 rounded-lg border-pink-200 bg-white px-3 text-sm font-medium text-pink-700 shadow-sm hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
              >
                <PlusIcon className="h-4 w-4" />
                Add First Employee
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="px-4">
              <UsersTable
                rows={rows}
                onView={(id) => router.push(EMPLOYEES_ROUTES.detail(id))}
                onEdit={(id) => router.push(EMPLOYEES_ROUTES.edit(id))}
                onResetPassword={showAppActions && canResetPassword ? handleResetPassword : undefined}
                onCreateAccount={showAppActions && canCreateAccount ? setCreateAccountTarget : undefined}
                onLoginAs={canLoginAs ? handleLoginAs : undefined}
                loginAsEmployeeId={loginAsEmployeeId}
                showAppActions={showAppActions}
              />
            </div>
            <PurchasingTablePagination
              page={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={perPage}
              onPageChange={setPage}
            />
          </>
        )}
      </PurchasingListSection>

      <ResetPasswordDialog
        target={resetTarget}
        open={resetDialogOpen}
        onOpenChange={(open) => {
          setResetDialogOpen(open);
          if (!open) setResetTarget(null);
        }}
        onError={(message) => showToast(message, "error")}
      />

      {createAccountTarget && (
        <CreateAccountDialog
          employee={{
            id: createAccountTarget.id,
            full_name: createAccountTarget.fullName,
            email: createAccountTarget.email ?? "",
          }}
          open
          onOpenChange={(open) => {
            if (!open) setCreateAccountTarget(null);
          }}
          onSuccess={(message) => showToast(message)}
          onError={(message) => showToast(message, "error")}
        />
      )}
    </div>
  );
}
