import type {
  JournalEntryStatus,
  JournalLineSide,
} from "@/lib/accounting/fiscal-types";

export type JournalEntryType = "MANUAL" | "OPENING" | "AUTO";

export interface JournalEntryLineItem {
  id: string;
  entry_id: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  entry_side: JournalLineSide;
  amount: number;
  memo: string | null;
  sort_order: number;
}

export interface JournalEntryItem {
  id: string;
  company_id: string | null;
  entry_no: string;
  entry_date: string;
  description: string | null;
  fiscal_period_id: string;
  fiscal_period_name: string | null;
  fiscal_year_code: string | null;
  entry_type: JournalEntryType;
  status: JournalEntryStatus;
  is_recon: boolean;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  updated_at: string | null;
  source_module?: string | null;
  source_event_code?: string | null;
  source_document_type?: string | null;
  source_document_id?: string | null;
  lines: JournalEntryLineItem[];
  total_debit: number;
  total_credit: number;
  can_edit: boolean;
}

export interface JournalEntryLinePayload {
  id?: string;
  account_id: string;
  entry_side: JournalLineSide;
  amount: number;
  memo?: string | null;
  sort_order?: number;
}

export interface JournalEntryPayload {
  entry_date: string;
  description?: string | null;
  lines: JournalEntryLinePayload[];
  /** If true, save as POSTED in one step */
  post?: boolean;
}

export interface JournalEntryListFilters {
  search?: string;
  status?: string;
  date_from?: string;
  date_to?: string;
  entry_type?: string;
  account_id?: string;
}
