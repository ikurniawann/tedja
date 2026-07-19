"use client";

import { useQuery } from "@tanstack/react-query";
import { kpiQueryKeys } from "./query-keys";
import { fetchKpiHistory, fetchKpiScorecards, fetchKpiTargets } from "./api";

export const useKpiScorecards = (params: {
  period_year: number;
  period_month: number;
  employee_id?: string;
}) =>
  useQuery({
    queryKey: kpiQueryKeys.scorecards(params),
    queryFn: () => fetchKpiScorecards(params),
  });

export const useKpiHistory = (employeeId: string, n = 12) =>
  useQuery({
    queryKey: kpiQueryKeys.history(employeeId, n),
    queryFn: () => fetchKpiHistory({ employee_id: employeeId, history: n }),
  });

export const useKpiTargets = (enabled = true) =>
  useQuery({
    queryKey: kpiQueryKeys.targets(),
    queryFn: fetchKpiTargets,
    enabled,
  });
