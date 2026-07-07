import { CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS } from "@/types/supplier";

export const SUPPLIER_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Code",
    required: false,
    description: "Leave empty to auto-generate SUP-YYYY-####",
  },
  { key: "nama_supplier", label: "Supplier Name", required: true },
  { key: "pic_name", label: "Contact Person", required: false },
  { key: "pic_phone", label: "Contact Phone", required: false },
  { key: "pic_email", label: "Contact Email", required: false, type: "email" as const },
  { key: "telepon", label: "Company Phone", required: false },
  { key: "email", label: "Company Email", required: false, type: "email" as const },
  { key: "alamat", label: "Address", required: false },
  { key: "kota", label: "City", required: false },
  { key: "npwp", label: "Tax ID (NPWP)", required: false },
  {
    key: "payment_terms",
    label: "Payment Terms",
    required: false,
    description: PAYMENT_TERMS_OPTIONS.join(", "),
  },
  {
    key: "currency",
    label: "Currency",
    required: false,
    description: CURRENCY_OPTIONS.join(", "),
  },
  { key: "bank_nama", label: "Bank Name", required: false },
  { key: "bank_rekening", label: "Bank Account No.", required: false },
  { key: "bank_atas_nama", label: "Account Holder", required: false },
  { key: "kategori", label: "Category", required: false },
  { key: "catatan", label: "Notes", required: false },
  {
    key: "status",
    label: "Status",
    required: false,
    description: "active, inactive, probation, blocked, or draft",
  },
];
