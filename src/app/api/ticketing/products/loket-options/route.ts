import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

interface LoketOptionRow {
  variant_id: string;
  variant_name: string;
  ticket_product_id: string;
  ticket_code: string;
  ticket_name: string;
  price_regular: string | null;
  price_high: string | null;
}

/**
 * Opsi ticket utk registrasi loket: hanya produk Active yang
 * terdistribusi ke kanal walk-in, per varian aktif.
 */
export async function GET() {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const rows = await query<LoketOptionRow>(
      `SELECT pv.id AS variant_id, pv.name AS variant_name,
              tp.id AS ticket_product_id, tp.code AS ticket_code,
              tp.name AS ticket_name, pv.price_regular, pv.price_high
       FROM ticketing.ticket_product_variants pv
       JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
       JOIN ticketing.ticket_product_channels pc
         ON pc.ticket_product_id = tp.id AND pc.is_distributed = true
       JOIN ticketing.ticket_channels ch
         ON ch.id = pc.channel_id AND ch.code = 'walk-in'
       WHERE tp.branch_id = $1 AND tp.company_id = $2
         AND tp.status = 'active' AND pv.is_active = true
       ORDER BY tp.name, pv.sort_order`,
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(
      rows.map((row) => ({
        ...row,
        price_regular:
          row.price_regular === null ? null : Number(row.price_regular),
        price_high: row.price_high === null ? null : Number(row.price_high),
      }))
    );
  } catch (err) {
    console.error("[ticketing] loket options error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat opsi ticket" },
      { status: 500 }
    );
  }
}
