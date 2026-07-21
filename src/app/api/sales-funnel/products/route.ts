import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/**
 * Katalog produk untuk picker quotation (Fase F1) — pos_products aktif,
 * bidang minimal. Keputusan owner: katalog quotation = pos_products.
 */
export async function GET() {
  const { error } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const rows = await query(
      `SELECT id, name, base_price
       FROM pos.pos_products
       WHERE is_active = true
       ORDER BY name ASC
       LIMIT 200`
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list products error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat katalog produk" },
      { status: 500 }
    );
  }
}
