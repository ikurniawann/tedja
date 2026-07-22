export type BandStatus = "tersedia" | "dipakai" | "hilang" | "rusak";
export type ReEntryPolicy = "sekali-masuk" | "bebas-keluar-masuk";
export type PaymentMode = "postpaid" | "prepaid";

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
  booking_slug: string | null;
  updated_at: string;
}

export interface SettingsFormValues {
  re_entry_policy?: ReEntryPolicy;
  default_credit_limit?: number;
  default_payment_mode?: PaymentMode;
  booking_slug?: string | null;
}
