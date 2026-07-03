export type VendorCategory =
  | "it"
  | "office"
  | "stationery"
  | "services"
  | "raw_material"
  | "other";

export interface Vendor {
  id: string;
  code: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  category: VendorCategory;
  npwp?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_account_name?: string | null;
  is_active: boolean;
  notes?: string | null;
  created_at?: string;
  company_id?: string | null;
  branch_id?: string | null;
}

export interface VendorFormData {
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  category: VendorCategory;
  npwp?: string;
  bank_name?: string;
  bank_account?: string;
  bank_account_name?: string;
  notes?: string;
}

export interface VendorListParams {
  search?: string;
  category?: VendorCategory | "all";
  status?: "all" | "active" | "inactive";
  page?: number;
  limit?: number;
}

export const VENDOR_CATEGORY_OPTIONS: { value: VendorCategory; label: string }[] = [
  { value: "it", label: "IT" },
  { value: "office", label: "Office" },
  { value: "stationery", label: "Stationery" },
  { value: "services", label: "Services" },
  { value: "raw_material", label: "Raw Material" },
  { value: "other", label: "Other" },
];

export function getVendorCategoryLabel(category?: VendorCategory | string | null) {
  return VENDOR_CATEGORY_OPTIONS.find((row) => row.value === category)?.label ?? category ?? "-";
}
