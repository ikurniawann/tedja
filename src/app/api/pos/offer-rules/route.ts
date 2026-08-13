import { NextResponse } from "next/server";
import { getPosSession, successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
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

/** Active product offers for cashier banners + client preview. */
export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.companyId || !venue.branchId) {
      return successResponse([]);
    }

    const rows = await listActiveOfferRules({
      companyId: venue.companyId,
      branchId: venue.branchId,
      todayIsoDate: todayJakartaIso(),
    });

    const data = rows.map((rule) => ({
      id: rule.id,
      offer_type: rule.offer_type,
      name: rule.name,
      description: rule.description,
      valid_from: rule.valid_from,
      valid_until: rule.valid_until,
      bundle_price: rule.bundle_price != null ? Number(rule.bundle_price) : null,
      buy_qty: rule.buy_qty,
      get_qty: rule.get_qty,
      get_mode: rule.get_mode,
      volume_basis: rule.volume_basis,
      volume_min: rule.volume_min != null ? Number(rule.volume_min) : null,
      discount_type: rule.discount_type,
      discount_value:
        rule.discount_value != null ? Number(rule.discount_value) : null,
      items: rule.items.map((item) => ({
        role: item.role,
        product_id: item.product_id,
        product_name: item.product_name ?? null,
        qty: Number(item.qty) || 1,
      })),
      eval: toOfferEvalRules([rule])[0],
    }));

    return successResponse(data);
  } catch (err) {
    console.error("[pos/offer-rules] GET failed:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat promo aktif" },
      { status: 500 }
    );
  }
}
