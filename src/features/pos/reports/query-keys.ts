import type { ProfitReportParams, ClosingReportParams } from "./types";

export const reportsQueryKeys = {
  all: ["pos", "reports"] as const,
  profit: (params: ProfitReportParams) => ["pos", "reports", "profit", params] as const,
  closing: (params: ClosingReportParams) => ["pos", "reports", "closing", params] as const,
};
