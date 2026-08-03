export const FISCAL_PERIOD_STATUSES = ["OPEN", "CLOSED"] as const;
export type FiscalPeriodStatus = (typeof FISCAL_PERIOD_STATUSES)[number];

export const JOURNAL_ENTRY_STATUSES = ["DRAFT", "POSTED"] as const;
export type JournalEntryStatus = (typeof JOURNAL_ENTRY_STATUSES)[number];

export const JOURNAL_LINE_SIDES = ["DEBIT", "CREDIT"] as const;
export type JournalLineSide = (typeof JOURNAL_LINE_SIDES)[number];

export type ResolvedFiscalPeriod = {
  id: string;
  fiscal_year_id: string;
  period_no: number;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
  fiscal_year_code: string;
  fiscal_year_name: string;
  fiscal_year_is_active: boolean;
};

/** Period CLOSED yang menutupi tanggal + saran open (dengan auto-close previous). */
export type FiscalOpenSuggestion = {
  period: ResolvedFiscalPeriod;
  can_open: boolean;
  close_previous: Array<{
    id: string;
    period_no: number;
    name: string;
  }>;
  message: string;
};

export type FiscalCoverageResult = {
  date: string;
  ready: boolean;
  period: ResolvedFiscalPeriod | null;
  suggestion: FiscalOpenSuggestion | null;
};
