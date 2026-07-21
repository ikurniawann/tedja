import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

export async function GET() {
  const { error } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const rows = await query(
      `SELECT id, code, name, sort_order FROM crm.crm_sales_lost_reasons
       WHERE is_active = true
       ORDER BY sort_order ASC, created_at ASC`
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list lost reasons error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat alasan kalah" },
      { status: 500 }
    );
  }
}
