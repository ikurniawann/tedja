export type LeadOrgType =
  | "corporate"
  | "sekolah"
  | "komunitas"
  | "travel-agent"
  | "pemerintah"
  | "perorangan"
  | "lainnya";

export type LeadSource =
  | "wa"
  | "instagram"
  | "referral"
  | "google"
  | "pameran"
  | "canvassing"
  | "lainnya";

export type LeadTemperature = "panas" | "hangat" | "dingin";

export type LeadStatus = "baru" | "dihubungi" | "qualified" | "tidak-cocok";

export interface SalesLead {
  id: string;
  company_id: string;
  branch_id: string;
  org_name: string;
  org_type: LeadOrgType;
  pic_name: string;
  pic_title: string | null;
  pic_phone: string;
  pic_email: string | null;
  city: string | null;
  source: LeadSource;
  temperature: LeadTemperature;
  status: LeadStatus;
  notes: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadFilters {
  q: string;
  status: string;
  org_type: string;
  source: string;
  page: number;
}

export interface LeadFormValues {
  org_name: string;
  org_type: LeadOrgType;
  pic_name: string;
  pic_title: string;
  pic_phone: string;
  pic_email: string;
  city: string;
  source: LeadSource;
  temperature: LeadTemperature;
  status: LeadStatus;
  notes: string;
}

export interface LeadListResponse {
  success: boolean;
  data: SalesLead[];
  pagination: { page: number; limit: number; total: number; totalPages?: number };
}

export const ORG_TYPE_LABELS: Record<LeadOrgType, string> = {
  corporate: "Corporate",
  sekolah: "Sekolah",
  komunitas: "Komunitas",
  "travel-agent": "Travel Agent",
  pemerintah: "Pemerintah",
  perorangan: "Perorangan",
  lainnya: "Lainnya",
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  wa: "WhatsApp",
  instagram: "Instagram",
  referral: "Referral",
  google: "Google",
  pameran: "Pameran",
  canvassing: "Canvassing",
  lainnya: "Lainnya",
};

export const TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  panas: "Panas",
  hangat: "Hangat",
  dingin: "Dingin",
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  baru: "Baru",
  dihubungi: "Dihubungi",
  qualified: "Qualified",
  "tidak-cocok": "Tidak Cocok",
};

export const EMPTY_LEAD_FORM: LeadFormValues = {
  org_name: "",
  org_type: "corporate",
  pic_name: "",
  pic_title: "",
  pic_phone: "",
  pic_email: "",
  city: "",
  source: "lainnya",
  temperature: "hangat",
  status: "baru",
  notes: "",
};
