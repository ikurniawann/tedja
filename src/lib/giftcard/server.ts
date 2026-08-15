// EPIC-034 Fase A — guard route gift card. Dikelola oleh peran yang sama
// dgn Promo (super_admin + marketing) krn tab Gift Card menumpang menu
// Promo EPIC-032; venue resolver di-reuse dari requirePromoContext.

export { PROMO_MANAGER_ROLES, requirePromoContext } from "@/lib/promo/server";
export type { PromoContext } from "@/lib/promo/server";
