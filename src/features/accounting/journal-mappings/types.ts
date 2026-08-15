import type {
  JournalAmountSource,
  JournalEntrySide,
  JournalEventCode,
  JournalLineRole,
  JournalModule,
} from "@/lib/accounting/journal-mapping-types";

export interface JournalMappingLineItem {
  id: string;
  mapping_id: string;
  entry_side: JournalEntrySide;
  line_role: string;
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
  amount_source: JournalAmountSource;
  sort_order: number;
  is_required: boolean;
}

export interface JournalMappingItem {
  id: string;
  company_id: string | null;
  event_code: string;
  name: string;
  description: string | null;
  module: JournalModule;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  lines: JournalMappingLineItem[];
  lines_count: number;
  mapped_count: number;
}

export interface JournalMappingLinePayload {
  id?: string;
  entry_side: JournalEntrySide;
  line_role: JournalLineRole | string;
  account_id?: string | null;
  amount_source: JournalAmountSource;
  sort_order?: number;
  is_required?: boolean;
}

export interface JournalMappingPayload {
  event_code: JournalEventCode | string;
  name: string;
  description?: string | null;
  module: JournalModule;
  is_active?: boolean;
  lines: JournalMappingLinePayload[];
}

export interface JournalMappingListFilters {
  search?: string;
  module?: string;
  is_active?: string;
}
