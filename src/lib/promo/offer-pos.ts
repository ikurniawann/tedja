import { evaluateOfferRules, type OfferCartLine } from "@/lib/promo/offer-evaluate";
import {
  listActiveOfferRules,
  toOfferEvalRules,
} from "@/lib/promo/offer-rules-server";

function todayJakartaIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Load active offer rules and evaluate against cart lines (server-side). */
export async function evaluateActiveOffersForPosCart(input: {
  companyId: string | null | undefined;
  branchId: string | null | undefined;
  items: OfferCartLine[];
}) {
  if (!input.companyId || !input.branchId || input.items.length === 0) {
    return { offer_discount: 0, applied: [] as ReturnType<typeof evaluateOfferRules>["applied"] };
  }

  const rows = await listActiveOfferRules({
    companyId: input.companyId,
    branchId: input.branchId,
    todayIsoDate: todayJakartaIso(),
  });
  if (rows.length === 0) {
    return { offer_discount: 0, applied: [] as ReturnType<typeof evaluateOfferRules>["applied"] };
  }

  return evaluateOfferRules(input.items, toOfferEvalRules(rows));
}
