"use client";

import { useQuery } from "@tanstack/react-query";
import { getCrmReports } from "./api";
import type { CrmReportPeriodInput } from "./types";

export const reportQueryKeys = {
  all: ["crm", "reports"] as const,
  period: (period: Partial<CrmReportPeriodInput>) =>
    [...reportQueryKeys.all, period.from ?? "", period.to ?? ""] as const,
};

export const useCrmReports = (period: Partial<CrmReportPeriodInput>) =>
  useQuery({
    queryKey: reportQueryKeys.period(period),
    queryFn: () => getCrmReports(period),
  });
