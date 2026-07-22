import type { BookingStatus } from "@/lib/ticketing/booking";

export type { BookingStatus };

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  "menunggu-bayar": "Menunggu Bayar",
  terbayar: "Terbayar",
  digunakan: "Digunakan",
  kedaluwarsa: "Kedaluwarsa",
  dibatalkan: "Dibatalkan",
};

export const BOOKING_STATUS_BADGES: Record<BookingStatus, string> = {
  "menunggu-bayar": "bg-amber-100 text-amber-700",
  terbayar: "bg-emerald-100 text-emerald-700",
  digunakan: "bg-blue-100 text-blue-700",
  kedaluwarsa: "bg-gray-100 text-gray-500",
  dibatalkan: "bg-red-100 text-red-700",
};

export interface BookingItem {
  product_name: string;
  variant_name: string;
  qty: number;
  unit_price: number;
  season_kind: string;
  subtotal: number;
}

export interface BookingLookupItem extends BookingItem {
  variant_id: string;
  ticket_product_id: string;
}

/** Hasil lookup kode di loket (D4) — bekal dialog redeem. */
export interface BookingLookup {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: BookingStatus;
  total: number;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  redeemable: boolean;
  today: string;
  items: BookingLookupItem[];
}

export interface BookingListItem {
  id: string;
  booking_code: string;
  visit_date: string;
  customer_name: string;
  customer_phone: string;
  status: BookingStatus;
  total: number;
  paid_at: string | null;
  used_at: string | null;
  visit_id: string | null;
  refund_note: string | null;
  created_at: string;
}

export interface BookingListResponse {
  success: boolean;
  data: BookingListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface BookingFilters {
  date: string;
  status: BookingStatus | "";
  q: string;
  page: number;
}

export interface BookingDetail extends BookingListItem {
  xendit_invoice_url: string | null;
  expires_at: string | null;
  items: BookingItem[];
}

export interface RedeemBand {
  nfc_uid: string;
  variant_id: string;
}
