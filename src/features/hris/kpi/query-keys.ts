export const kpiQueryKeys = {
  all: ["hris", "kpi"] as const,
  scorecards: (params?: Record<string, unknown>) =>
    ["hris", "kpi", "scorecards", params ?? {}] as const,
  history: (employeeId: string, n: number) =>
    ["hris", "kpi", "history", employeeId, n] as const,
  targets: () => ["hris", "kpi", "targets"] as const,
  team: (params?: Record<string, unknown>) =>
    ["hris", "kpi", "team", params ?? {}] as const,
};
