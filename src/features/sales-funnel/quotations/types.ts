export type QuotationStatus = "draft" | "terkirim" | "diterima" | "ditolak";
export type QuotationItemType = "produk" | "bebas";

export interface QuotationItem {
  id: string;
  item_type: QuotationItemType;
  product_id: string | null;
  description: string;
  qty: string | number;
  unit_price: string | number;
  line_total: string | number;
}

export type BomStatus = "terpotong" | "tidak-terpotong";

export interface Quotation {
  id: string;
  quote_number: string;
  status: QuotationStatus;
  use_ppn: boolean;
  ppn_persen: string | number;
  subtotal: string | number;
  ppn_nominal: string | number;
  total: string | number;
  notes: string | null;
  valid_until: string | null;
  stock_deducted_at: string | null;
  bom_status: BomStatus | null;
  created_at: string;
  items: QuotationItem[];
}

export interface StockShortage {
  raw_material_id: string;
  kode: string | null;
  nama: string;
  satuan: string | null;
  needed: number;
  available: number;
}

/** 409 realisasi: bawa detail kekurangan utk dialog "lanjut tanpa BOM". */
export class RealizeConflictError extends Error {
  constructor(
    message: string,
    public shortages: StockShortage[],
    public warnings: string[]
  ) {
    super(message);
    this.name = "RealizeConflictError";
  }
}

export interface CatalogProduct {
  id: string;
  name: string;
  base_price: string | number;
}

export interface QuotationItemForm {
  item_type: QuotationItemType;
  product_id: string;
  description: string;
  qty: string;
  unit_price: string;
}

export interface QuotationFormValues {
  use_ppn: boolean;
  ppn_persen: string;
  notes: string;
  valid_until: string;
  items: QuotationItemForm[];
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: "Draft",
  terkirim: "Terkirim",
  diterima: "Diterima",
  ditolak: "Ditolak",
};

export const QUOTATION_STATUS_BADGES: Record<QuotationStatus, string> = {
  draft: "border-0 bg-gray-100 font-normal text-gray-600",
  terkirim: "border-0 bg-blue-100 font-normal text-blue-700",
  diterima: "border-0 bg-emerald-100 font-normal text-emerald-700",
  ditolak: "border-0 bg-red-100 font-normal text-red-700",
};

export const EMPTY_ITEM_FORM: QuotationItemForm = {
  item_type: "bebas",
  product_id: "",
  description: "",
  qty: "1",
  unit_price: "",
};

export const EMPTY_QUOTATION_FORM: QuotationFormValues = {
  use_ppn: true,
  ppn_persen: "11",
  notes: "",
  valid_until: "",
  items: [{ ...EMPTY_ITEM_FORM }],
};

export function itemLineTotal(item: QuotationItemForm): number {
  const qty = Number(item.qty) || 0;
  const price = Number(item.unit_price) || 0;
  return Math.round(qty * price * 100) / 100;
}

export function formTotals(form: QuotationFormValues): {
  subtotal: number;
  ppn: number;
  total: number;
} {
  const subtotal =
    Math.round(form.items.reduce((acc, item) => acc + itemLineTotal(item), 0) * 100) /
    100;
  const ppn = form.use_ppn
    ? Math.round(subtotal * (Number(form.ppn_persen) || 0)) / 100
    : 0;
  return { subtotal, ppn, total: Math.round((subtotal + ppn) * 100) / 100 };
}

/** Payload API dari nilai form (angka dikonversi, baris kosong dibuang). */
export function formToPayload(form: QuotationFormValues) {
  return {
    use_ppn: form.use_ppn,
    ppn_persen: Number(form.ppn_persen) || 0,
    notes: form.notes || null,
    valid_until: form.valid_until || null,
    items: form.items
      .filter((item) => item.description.trim() && Number(item.qty) > 0)
      .map((item) => ({
        item_type: item.item_type,
        product_id: item.item_type === "produk" ? item.product_id || null : null,
        description: item.description.trim(),
        qty: Number(item.qty),
        unit_price: Number(item.unit_price) || 0,
      })),
  };
}
