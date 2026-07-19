import { apiGet, buildListUrl } from "@/lib/api-client";
import type {
  KpiScorecardsResult,
  SaveRubricPayload,
  SnapshotSummaryResult,
} from "./types";

const BASE = "/api/hris/kpi";

async function mutateKpi(
  method: "POST" | "PATCH",
  path: string,
  body: Record<string, unknown>
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || "Request failed");
  return json;
}

export const fetchKpiScorecards = (params: {
  period_year: number;
  period_month: number;
  employee_id?: string;
}) =>
  apiGet<KpiScorecardsResult>(buildListUrl(`${BASE}/scorecards`, params));

export const fetchKpiHistory = (params: {
  employee_id: string;
  history: number;
}) =>
  apiGet<KpiScorecardsResult>(buildListUrl(`${BASE}/scorecards`, params));

export const runKpiSnapshotApi = (payload: {
  period_month: number;
  period_year: number;
}) =>
  mutateKpi("POST", "/snapshot", payload) as Promise<{
    data: SnapshotSummaryResult;
    message?: string;
  }>;

export const saveKpiRubric = (payload: SaveRubricPayload) =>
  mutateKpi("POST", "/rubric", { ...payload });

export const updateScorecardStatus = (payload: {
  action: "finalize" | "reopen";
  scorecard_id: string;
}) => mutateKpi("PATCH", "/scorecards", payload);
