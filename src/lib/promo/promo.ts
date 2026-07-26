// EPIC-032 — evaluator promo murni (tanpa DB, pola pricing/capacity):
// pemanggil menyuplai aturan campaign + keadaan kode + konteks pemakaian
// (hitungan hidup dari SQL), fungsi ini memutuskan lolos/tolak + besar
// diskon. Keputusan owner 26 Jul: diskon PER TRANSAKSI, 1 kode per
// transaksi (stacking = Fase E).

export type PromoScope =
  | "ticketing_online"
  | "ticketing_loket"
  | "pos"
  | "semua";

export type PromoDiscountType = "percent" | "fixed";

/** Aturan campaign (baris promo_campaigns yang relevan utk evaluasi). */
export interface PromoCampaignRule {
  discount_type: PromoDiscountType;
  value: number;
  /** Cap rupiah utk percent; null = tanpa cap. Diabaikan utk fixed. */
  max_discount: number | null;
  min_purchase: number;
  valid_from: string | null; // YYYY-MM-DD inklusif
  valid_until: string | null;
  /** Batas total pemakaian lintas kode; null = tanpa batas. */
  usage_limit: number | null;
  /** Batas pemakaian per nomor WA; null = bebas. */
  per_phone_limit: number | null;
  scope: PromoScope;
  is_active: boolean;
}

/** Keadaan kode (baris promo_codes). */
export interface PromoCodeState {
  is_active: boolean;
  /** null = ikut limit campaign; 1 = voucher sekali pakai. */
  usage_limit: number | null;
  usage_count: number;
}

/** Konteks pemakaian — hitungan hidup disuplai pemanggil (SQL). */
export interface PromoUsageContext {
  today: string; // YYYY-MM-DD WIB
  channel: Exclude<PromoScope, "semua">;
  subtotal: number;
  /** Redemption hidup (held/captured) lintas semua kode campaign. */
  campaignUsedCount: number;
  /** Redemption hidup campaign ini utk nomor WA pemesan. */
  phoneUsedCount: number;
}

export type PromoRejectReason =
  | "nonaktif"
  | "belum-mulai"
  | "kedaluwarsa"
  | "scope"
  | "min-pembelian"
  | "kuota-habis"
  | "limit-nomor";

export type PromoEvalResult =
  | { ok: true; discount: number }
  | { ok: false; reason: PromoRejectReason };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Besar diskon utk satu subtotal: percent dibulatkan 2dp lalu kena cap
 * `max_discount`; fixed apa adanya. Keduanya tak pernah melebihi subtotal
 * (total transaksi tidak boleh negatif).
 */
export function computeDiscount(
  campaign: Pick<PromoCampaignRule, "discount_type" | "value" | "max_discount">,
  subtotal: number
): number {
  let discount =
    campaign.discount_type === "percent"
      ? round2((subtotal * campaign.value) / 100)
      : campaign.value;
  if (campaign.discount_type === "percent" && campaign.max_discount !== null) {
    discount = Math.min(discount, campaign.max_discount);
  }
  return Math.min(discount, subtotal);
}

/**
 * Evaluasi lengkap satu kode utk satu transaksi. Urutan cek deterministik
 * (aktif → window → scope → min pembelian → kuota → limit nomor) supaya
 * pesan penolakan stabil & mudah diuji.
 */
export function evaluatePromo(
  campaign: PromoCampaignRule,
  code: PromoCodeState,
  ctx: PromoUsageContext
): PromoEvalResult {
  if (!campaign.is_active || !code.is_active) {
    return { ok: false, reason: "nonaktif" };
  }
  if (campaign.valid_from !== null && ctx.today < campaign.valid_from) {
    return { ok: false, reason: "belum-mulai" };
  }
  if (campaign.valid_until !== null && ctx.today > campaign.valid_until) {
    return { ok: false, reason: "kedaluwarsa" };
  }
  if (campaign.scope !== "semua" && campaign.scope !== ctx.channel) {
    return { ok: false, reason: "scope" };
  }
  // Subtotal 0 tidak pernah layak didiskon (dan lolosnya membingungkan)
  if (ctx.subtotal <= 0 || ctx.subtotal < campaign.min_purchase) {
    return { ok: false, reason: "min-pembelian" };
  }
  // Kuota: limit KODE lebih spesifik — bila terisi, dialah yang berlaku;
  // tanpa limit kode, jatuh ke limit campaign (lintas semua kodenya)
  if (code.usage_limit !== null) {
    if (code.usage_count >= code.usage_limit) {
      return { ok: false, reason: "kuota-habis" };
    }
  } else if (
    campaign.usage_limit !== null &&
    ctx.campaignUsedCount >= campaign.usage_limit
  ) {
    return { ok: false, reason: "kuota-habis" };
  }
  if (
    campaign.per_phone_limit !== null &&
    ctx.phoneUsedCount >= campaign.per_phone_limit
  ) {
    return { ok: false, reason: "limit-nomor" };
  }
  return { ok: true, discount: computeDiscount(campaign, ctx.subtotal) };
}

/** Pesan penolakan ramah pengunjung (dipakai endpoint publik & wizard). */
export const PROMO_REJECT_MESSAGES: Record<PromoRejectReason, string> = {
  nonaktif: "Kode promo tidak dikenal atau sudah tidak berlaku",
  "belum-mulai": "Kode promo belum mulai berlaku",
  kedaluwarsa: "Kode promo sudah berakhir",
  scope: "Kode promo tidak berlaku untuk pembelian ini",
  "min-pembelian": "Belanja belum mencapai minimum untuk kode ini",
  "kuota-habis": "Kuota kode promo sudah habis",
  "limit-nomor": "Nomor ini sudah memakai kode promo ini",
};
