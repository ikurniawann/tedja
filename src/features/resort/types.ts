import type { ReservationSource, ReservationStatus } from "@/lib/resort/reservation";

export interface RoomTypeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  zone: string | null;
  capacity_adults: number;
  capacity_children: number;
  extra_bed_capacity: number;
  rate_weekday: number;
  rate_weekend: number;
  extra_bed_rate: number;
  amenities: string[];
  is_active: boolean;
  sort_order: number;
  room_count: number;
}

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  status: "siap" | "kotor" | "perbaikan" | "ditutup";
  notes: string | null;
  is_active: boolean;
  room_type_id: string;
  room_type_name: string;
  room_type_code: string;
  reservation_id: string | null;
  guest_name: string | null;
  occupied_until: string | null;
}

export interface RateSeasonRow {
  room_type_id: string | null;
  label: string;
  start_date: string;
  end_date: string;
  rate: number | null;
  surcharge_percent: number | null;
}

export interface NightRateRow { date: string; rate: number; weekend: boolean; season: string | null }

export interface AvailabilityType extends RoomTypeRow {
  rooms_total: number;
  available: number;
  per_night: Array<{ date: string; rooms: number; booked: number; available: number }>;
  free_rooms: Array<{ id: string; code: string; name: string; status: string }>;
  quote: { nights: number; breakdown: NightRateRow[]; room_subtotal: number; extra_bed_total: number; subtotal: number };
}

export interface ReservationListRow {
  id: string;
  reservation_code: string;
  guest_name: string;
  guest_phone: string;
  guest_email: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  status: ReservationStatus;
  source: ReservationSource;
  total: number;
  balance: number;
  notes: string | null;
  room_count: number;
  room_types: string | null;
  rooms_label?: string | null;
  special_request?: string | null;
  created_by_name: string | null;
  created_at: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
}

export interface ReservationRoomRow {
  id: string;
  room_type_id: string;
  room_id: string | null;
  room_type_name: string;
  room_name: string | null;
  room_code: string | null;
  room_status: string | null;
  guest_name: string | null;
  nightly_rate: number;
  nights: number;
  extra_bed: number;
  subtotal: number;
  rate_breakdown: NightRateRow[];
}

export interface FolioRow {
  id: string;
  charge_type: string;
  direction: "debit" | "kredit";
  description: string;
  amount: number;
  payment_method: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface ReservationDetail extends ReservationListRow {
  rooms: ReservationRoomRow[];
  folio: FolioRow[];
  totals: { charges: number; payments: number; balance: number };
  cancel_reason?: string | null;
}

export interface FrontOfficeBoard {
  date: string;
  arrivals: ReservationListRow[];
  departures: ReservationListRow[];
  in_house: ReservationListRow[];
  rooms: Array<{
    id: string; code: string; name: string; status: RoomRow["status"]; zone: string | null;
    room_type_name: string; guest_name: string | null; occupied_until: string | null;
  }>;
  summary: {
    rooms_total: number; occupied: number; vacant: number; occupancy_pct: number;
    arrivals: number; departures: number;
  };
}

export const rupiah = (v: number | string | null | undefined) =>
  `Rp ${Math.round(Number(v) || 0).toLocaleString("id-ID")}`;

export const tanggal = (iso: string | null | undefined, withTime = false) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleString("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
        timeZone: iso.length === 10 ? "UTC" : "Asia/Jakarta",
      })
    : "—";

export const STATUS_CLASS: Record<ReservationStatus, string> = {
  "menunggu-bayar": "border-amber-300 bg-amber-50 text-amber-800",
  terkonfirmasi: "border-sky-300 bg-sky-50 text-sky-800",
  "check-in": "border-emerald-300 bg-emerald-50 text-emerald-800",
  "check-out": "border-gray-300 bg-gray-50 text-gray-600",
  dibatalkan: "border-rose-300 bg-rose-50 text-rose-700",
  "no-show": "border-orange-300 bg-orange-50 text-orange-700",
};

export const ROOM_STATUS_CLASS: Record<RoomRow["status"], string> = {
  siap: "border-emerald-300 bg-emerald-50 text-emerald-800",
  kotor: "border-amber-300 bg-amber-50 text-amber-800",
  perbaikan: "border-orange-300 bg-orange-50 text-orange-800",
  ditutup: "border-gray-300 bg-gray-100 text-gray-600",
};
export const ROOM_STATUS_LABEL: Record<RoomRow["status"], string> = {
  siap: "Siap dijual", kotor: "Perlu dibersihkan", perbaikan: "Perbaikan", ditutup: "Ditutup",
};
