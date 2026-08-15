import type {
  JournalLineSide,
} from "@/lib/accounting/fiscal-types";

export const PL_ACCOUNT_TYPES = [
  "REVENUE",
  "COGS",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
] as const;

export const BS_ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY"] as const;

export type BeginningBalanceLine = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type_code: string;
  normal_balance: "DEBIT" | "CREDIT";
  is_contra: boolean;
  /** Suggested signed balance (positive = normal side) */
  suggested_amount: number;
  /** Editable amount (> 0) */
  amount: number;
  entry_side: JournalLineSide;
  source: "PRIOR_BS" | "RETAINED_EARNINGS" | "MANUAL";
};

export type BeginningBalanceSuggestion = {
  fiscal_year_id: string;
  fiscal_year_code: string;
  fiscal_year_name: string;
  start_date: string;
  period_id: string | null;
  period_name: string | null;
  prior_fiscal_year: {
    id: string;
    code: string;
    name: string;
    end_date: string;
    is_fully_closed: boolean;
  } | null;
  retained_earnings_account: {
    id: string;
    code: string;
    name: string;
  } | null;
  lines: BeginningBalanceLine[];
  total_debit: number;
  total_credit: number;
  existing_entry_id: string | null;
  existing_status: "DRAFT" | "POSTED" | null;
  can_edit: boolean;
  is_first_year: boolean;
  message: string | null;
};

export type BeginningBalanceSavePayload = {
  retained_earnings_account_id?: string | null;
  lines: Array<{
    account_id: string;
    entry_side: JournalLineSide;
    amount: number;
    memo?: string | null;
  }>;
  post?: boolean;
};
