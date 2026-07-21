import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const STAGE_COLUMNS = `
  id, code, name, sort_order, is_won, is_lost, stuck_threshold_days,
  is_active, created_at, updated_at`;

export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    // Tahap nonaktif hanya relevan untuk layar konfigurasi (super_admin);
    // kanban semua role cukup tahap aktif.
    const includeAll =
      user.role === "super_admin" &&
      new URL(request.url).searchParams.get("all") === "1";

    const rows = await query(
      `SELECT ${STAGE_COLUMNS} FROM crm.crm_sales_stages
       ${includeAll ? "" : "WHERE is_active = true"}
       ORDER BY sort_order ASC, created_at ASC`
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list stages error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat tahap pipeline" },
      { status: 500 }
    );
  }
}
