"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchEmployeeAttendance,
  fetchEmployeeContracts,
  fetchEmployeeDocuments,
  fetchExpiringContracts,
  fetchEmployeeLeaveBalances,
  fetchEmploymentHistory,
  fetchEmployeeLifecycle,
  fetchHRISEmployeeDetail,
  fetchUserDetail,
  fetchUserDirectoryStats,
  fetchUserFormLookups,
  fetchUserList,
  fetchBranchStalls,
} from "./api";
import { usersQueryKeys } from "./query-keys";
import type { UserListParams } from "./types";

export const useUserList = (params?: UserListParams) =>
  useQuery({
    queryKey: usersQueryKeys.list(params),
    queryFn: () => fetchUserList(params),
  });

export const useUserDetail = (id: string | null) =>
  useQuery({
    queryKey: usersQueryKeys.detail(id ?? ""),
    queryFn: () => fetchUserDetail(id!),
    enabled: id !== null,
  });

export const useUserDirectoryStats = () =>
  useQuery({
    queryKey: usersQueryKeys.directoryStats(),
    queryFn: fetchUserDirectoryStats,
  });

export const useUserFormLookups = () =>
  useQuery({
    queryKey: usersQueryKeys.formLookups(),
    queryFn: fetchUserFormLookups,
  });

export const useBranchStalls = (branchId: string | null) =>
  useQuery({
    queryKey: usersQueryKeys.branchStalls(branchId ?? ""),
    queryFn: () => fetchBranchStalls(branchId!),
    enabled: !!branchId,
  });

export const useEmployeeContracts = (employeeId: string, enabled = true) =>
  useQuery({
    queryKey: usersQueryKeys.contracts(employeeId),
    queryFn: async () => {
      const res = await fetchEmployeeContracts(employeeId);
      return res.data ?? [];
    },
    enabled: enabled && !!employeeId,
  });

export const useExpiringContracts = (days = 30) =>
  useQuery({
    queryKey: usersQueryKeys.expiringContracts(days),
    queryFn: async () => {
      const res = await fetchExpiringContracts(days);
      return res.data;
    },
  });

export const useHRISEmployeeDetail = (id: string) =>
  useQuery({
    queryKey: usersQueryKeys.hrisEmployee(id),
    queryFn: async () => {
      const res = await fetchHRISEmployeeDetail(id);
      return res.data;
    },
    enabled: !!id,
  });

export const useEmployeeDocuments = (employeeId: string, enabled = true) =>
  useQuery({
    queryKey: usersQueryKeys.documents(employeeId),
    queryFn: async () => {
      const res = await fetchEmployeeDocuments(employeeId);
      return res.data ?? [];
    },
    enabled: enabled && !!employeeId,
  });

export const useEmployeeLifecycle = (employeeId: string, enabled = true) =>
  useQuery({
    queryKey: usersQueryKeys.lifecycle(employeeId),
    queryFn: async () => {
      const res = await fetchEmployeeLifecycle(employeeId);
      return res.data;
    },
    enabled: enabled && !!employeeId,
  });

export const useEmploymentHistory = (employeeId: string, enabled = true) =>
  useQuery({
    queryKey: usersQueryKeys.employmentHistory(employeeId),
    queryFn: async () => {
      const res = await fetchEmploymentHistory(employeeId);
      return res.data ?? [];
    },
    enabled: enabled && !!employeeId,
  });

export const useEmployeeAttendance = (
  employeeId: string,
  month: number,
  year: number,
  enabled = true
) =>
  useQuery({
    queryKey: usersQueryKeys.attendance(employeeId, month, year),
    queryFn: async () => {
      const res = await fetchEmployeeAttendance(employeeId, month, year);
      return res.data ?? [];
    },
    enabled: enabled && !!employeeId,
  });

export const useEmployeeLeaveBalances = (employeeId: string, enabled = true) =>
  useQuery({
    queryKey: usersQueryKeys.leaveBalances(employeeId),
    queryFn: async () => {
      const res = await fetchEmployeeLeaveBalances(employeeId);
      return res.data ?? [];
    },
    enabled: enabled && !!employeeId,
  });
