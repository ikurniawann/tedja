export type OfferType = "bundle" | "bxgy" | "volume";
export type OfferItemRole = "component" | "buy" | "get" | "eligible";
export type BxgyGetMode = "same_as_buy" | "specific_products";
export type VolumeBasis = "qty" | "spend";
export type OfferDiscountType = "percent" | "fixed";

export type OfferRuleItemInput = {
  role: OfferItemRole;
  product_id: string;
  qty?: number;
  sort_order?: number;
};

export type OfferRuleInput = {
  offer_type: OfferType;
  name: string;
  description?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
  bundle_price?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  get_mode?: BxgyGetMode | null;
  volume_basis?: VolumeBasis | null;
  volume_min?: number | null;
  discount_type?: OfferDiscountType | null;
  discount_value?: number | null;
  items: OfferRuleItemInput[];
};

export function validateOfferRule(input: OfferRuleInput): string | null {
  const name = input.name?.trim();
  if (!name) return "Nama wajib diisi";

  if (input.valid_from && input.valid_until && input.valid_from > input.valid_until) {
    return "Tanggal mulai tidak boleh setelah tanggal selesai";
  }

  const items = input.items ?? [];

  if (input.offer_type === "bundle") {
    const components = items.filter((i) => i.role === "component");
    if (components.length < 2) return "Bundling minimal 2 produk komponen";
    if (!(Number(input.bundle_price) > 0)) return "Harga bundling wajib > 0";
    if (components.some((i) => !(Number(i.qty) > 0))) {
      return "Qty tiap komponen wajib > 0";
    }
    return null;
  }

  if (input.offer_type === "bxgy") {
    if (!(Number(input.buy_qty) > 0)) return "Qty beli wajib > 0";
    if (!(Number(input.get_qty) > 0)) return "Qty gratis wajib > 0";
    const buy = items.filter((i) => i.role === "buy");
    if (buy.length < 1) return "Pilih minimal 1 produk yang dibeli";
    const mode = input.get_mode ?? "same_as_buy";
    if (mode === "specific_products") {
      const get = items.filter((i) => i.role === "get");
      if (get.length < 1) return "Pilih minimal 1 produk gratis";
    }
    return null;
  }

  if (input.offer_type === "volume") {
    if (!input.volume_basis) return "Basis volume wajib (qty / belanja)";
    if (!(Number(input.volume_min) > 0)) return "Minimum qty/belanja wajib > 0";
    if (!input.discount_type) return "Tipe diskon wajib";
    if (!(Number(input.discount_value) > 0)) return "Nilai diskon wajib > 0";
    if (input.discount_type === "percent" && Number(input.discount_value) > 100) {
      return "Diskon persen maksimal 100";
    }
    return null;
  }

  return "Tipe offer tidak dikenal";
}

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  bundle: "Bundling",
  bxgy: "Buy X Get Y",
  volume: "Diskon Volume",
};
