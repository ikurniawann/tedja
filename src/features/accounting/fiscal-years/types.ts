import type { FiscalPeriodStatus } from "@/lib/accounting/fiscal-types";

export interface FiscalPeriodItem {
  id: string;
  fiscal_year_id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
}

export interface FiscalYearItem {
  id: string;
  company_id: string | null;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  periods: FiscalPeriodItem[];
  open_periods_count: number;
}

export interface FiscalPeriodPayload {
  id?: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
}

export interface FiscalYearPayload {
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active?: boolean;
  periods: FiscalPeriodPayload[];
}

export interface FiscalYearListFilters {
  search?: string;
  is_active?: string;
}
