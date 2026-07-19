export const kpiQueryKeys = {
  all: ["hris", "kpi"] as const,
  scorecards: (params?: Record<string, unknown>) =>
    ["hris", "kpi", "scorecards", params ?? {}] as const,
  history: (employeeId: string, n: number) =>
    ["hris", "kpi", "history", employeeId, n] as const,
};
