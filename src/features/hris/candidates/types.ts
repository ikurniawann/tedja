import type { Candidate } from "@/types";

export interface CandidateListParams {
  status: string;
  brand_id: string;
  position_id: string;
  search: string;
  date_from: string;
  date_to: string;
  page: number;
  perPage: number;
}

export interface CandidateListResult {
  data: Candidate[];
  count: number;
}

export interface CandidateBrand {
  id: string | number;
  name: string;
  is_active?: boolean;
}

export interface CreateCandidatePayload {
  full_name: string;
  email: string;
  phone: string;
  domicile: string;
  source: string;
  brand_id?: string | null;
  position_id?: string | null;
  status: string;
  notes?: string | null;
  last_experience?: string | null;
  last_education?: string | null;
  availability?: string | null;
  expected_salary?: number | null;
}

export interface CandidateView {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  domicile: string;
  date_of_birth?: string;
  gender?: string;
  brand_id?: string;
  position_id?: string;
  status: string;
  source: string;
  notes?: string;
  cv_url?: string;
  created_at: string;
  updated_at: string;
  brands?: { name: string } | null;
  positions?: { title: string } | null;
  promoted_to_employee_id?: string | null;
}

export interface CandidateActivity {
  id: string;
  candidate_id: string;
  activity_type: string;
  description: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface CandidateNote {
  id: string;
  candidate_id: string;
  content: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface CandidateDetailResult {
  candidate: CandidateView | null;
  activities: CandidateActivity[];
  notes: CandidateNote[];
}

export interface ChartDatum {
  name: string;
  value: number;
}

export interface CandidateAnalyticsResult {
  summary: {
    thisMonth: number;
    activePipeline: number;
    talentPool: number;
    openPositions: number;
  };
  weeklyData: { name: string; candidates: number }[];
  sourceData: ChartDatum[];
  funnelData: { stage: string; count: number }[];
  brandData: ChartDatum[];
  positionData: ChartDatum[];
}
