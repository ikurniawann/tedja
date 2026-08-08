import { CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS } from "@/types/supplier";

export const SUPPLIER_IMPORT_COLUMNS = [
  {
    key: "kode",
    label: "Kode",
    required: false,
    description: "Kosongkan untuk membuat otomatis SUP-YYYY-####",
  },
  { key: "nama_supplier", label: "Nama Supplier", required: true },
  { key: "pic_name", label: "Narahubung", required: false },
  { key: "pic_phone", label: "Telepon Narahubung", required: false },
  { key: "pic_email", label: "Email Narahubung", required: false, type: "email" as const },
  { key: "telepon", label: "Telepon Perusahaan", required: false },
  { key: "email", label: "Email Perusahaan", required: false, type: "email" as const },
  { key: "alamat", label: "Alamat", required: false },
  { key: "kota", label: "Kota", required: false },
  { key: "npwp", label: "NPWP", required: false },
  {
    key: "payment_terms",
    label: "Termin Pembayaran",
    required: false,
    description: PAYMENT_TERMS_OPTIONS.join(", "),
  },
  {
    key: "currency",
    label: "Mata Uang",
    required: false,
    description: CURRENCY_OPTIONS.join(", "),
  },
  { key: "bank_nama", label: "Nama Bank", required: false },
  { key: "bank_rekening", label: "Nomor Rekening", required: false },
  { key: "bank_atas_nama", label: "Atas Nama", required: false },
  { key: "kategori", label: "Kategori", required: false },
  { key: "catatan", label: "Catatan", required: false },
  {
    key: "status",
    label: "Status",
    required: false,
    description: "active, inactive, probation, blocked, atau draft",
  },
];
