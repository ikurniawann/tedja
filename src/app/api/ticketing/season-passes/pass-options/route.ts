import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

interface PassOptionRow {
  ticket_product_id: string;
  name: string;
  validity_months: number;
  entry_policy: string;
  visit_quota: number | null;
  unit_price: string | null;
}

/**
 * Opsi produk Season Pass untuk penerbitan di loket: hanya produk Active
 * berjenis season_pass yang punya config. Harga dari varian "Umum"
 * (fallback base_price).
 */
export async function GET() {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const rows = await query<PassOptionRow>(
      `SELECT tp.id AS ticket_product_id, tp.name,
              pc.validity_months, pc.entry_policy, pc.visit_quota,
              COALESCE(v.price_regular, tp.base_price) AS unit_price
       FROM ticketing.ticket_products tp
       JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
       LEFT JOIN LATERAL (
         SELECT price_regular FROM ticketing.ticket_product_variants
         WHERE ticket_product_id = tp.id AND is_active = true
         ORDER BY sort_order LIMIT 1
       ) v ON true
       WHERE tp.branch_id = $1 AND tp.company_id = $2
         AND tp.product_kind = 'season_pass' AND tp.status = 'active'
       ORDER BY tp.name`,
      [ctx.branchId, ctx.companyId]
    );

    return successResponse(
      rows.map((r) => ({
        ticket_product_id: r.ticket_product_id,
        name: r.name,
        validity_months: r.validity_months,
        entry_policy: r.entry_policy,
        visit_quota: r.visit_quota,
        unit_price: Number(r.unit_price ?? 0),
      }))
    );
  } catch (err) {
    console.error("[ticketing] pass options error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat produk pass" },
      { status: 500 }
    );
  }
}
