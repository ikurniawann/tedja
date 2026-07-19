/** pg numeric datang sebagai string — selalu Number() saat render */
export type PgNumeric = number | string | null;

export interface KpiBreakdownRow {
  code: string;
  weight: number;
  effectiveWeight: number;
  attainment: number | null;
  contribution: number;
}

export interface KpiIndicatorInfo {
  code: string;
  name: string;
  unit: string | null;
  direction: "higher_better" | "lower_better" | "boolean";
}

export interface KpiScorecardRow {
  id: string;
  employee_id: string;
  period_year: number;
  period_month: number;
  role_code: string;
  score: PgNumeric;
  raw_score: PgNumeric;
  used_weight: PgNumeric;
  breakdown: KpiBreakdownRow[];
  status: "draft" | "final";
  reviewed_by: string | null;
  reviewed_at: string | null;
  employee?: {
    id: string;
    full_name: string;
    nip: string;
    department_id: string | null;
    department?: { name: string } | null;
  } | null;
}

export interface KpiScorecardsResult {
  data: KpiScorecardRow[];
  indicators: KpiIndicatorInfo[];
  period_year?: number;
  period_month?: number;
}

export interface SnapshotSummaryResult {
  period_year: number;
  period_month: number;
  employees: number;
  snapshots_upserted: number;
  scorecards_upserted: number;
  scorecards_skipped_final: number;
  collectors: Record<string, number>;
}

export interface SaveRubricPayload {
  employee_id: string;
  period_month: number;
  period_year: number;
  value: number;
  notes?: string;
}
