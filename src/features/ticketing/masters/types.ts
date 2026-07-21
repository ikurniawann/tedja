export type SeasonKind = "regular" | "high";
export type BandStatus = "tersedia" | "dipakai" | "hilang" | "rusak";
export type ReEntryPolicy = "sekali-masuk" | "bebas-keluar-masuk";
export type PaymentMode = "postpaid" | "prepaid";

export interface TicketType {
  id: string;
  code: string;
  name: string;
  rule_note: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TicketTypeFormValues {
  code: string;
  name: string;
  rule_note: string | null;
  sort_order: number;
}

export interface TicketSeason {
  id: string;
  name: string;
  season_kind: SeasonKind;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SeasonFormValues {
  name: string;
  start_date: string;
  end_date: string;
}

export interface TicketChannel {
  id: string;
  code: string;
  name: string;
  is_online: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceEntry {
  id?: string;
  ticket_type_id: string;
  season_kind: SeasonKind;
  channel_id: string;
  price: number;
}

export interface PriceGap {
  ticket_type_id: string;
  season_kind: SeasonKind;
  channel_id: string;
}

export interface PriceMatrixResponse {
  prices: PriceEntry[];
  gaps: PriceGap[];
}

export interface TicketBand {
  id: string;
  nfc_uid: string;
  label: string | null;
  status: BandStatus;
  created_at: string;
  updated_at: string;
}

export interface BandFilters {
  q: string;
  status: BandStatus | "";
  page: number;
}

export interface BandListResponse {
  success: boolean;
  data: TicketBand[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface TicketingSettings {
  id: string;
  re_entry_policy: ReEntryPolicy;
  default_credit_limit: string;
  default_payment_mode: PaymentMode;
  updated_at: string;
}

export interface SettingsFormValues {
  re_entry_policy?: ReEntryPolicy;
  default_credit_limit?: number;
  default_payment_mode?: PaymentMode;
}
