import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const rows = await query(
      `SELECT id, code, name, is_online, sort_order, is_active,
              created_at, updated_at
       FROM ticketing.ticket_channels
       WHERE branch_id = $1 AND company_id = $2
       ORDER BY sort_order, name`,
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[ticketing] list channels error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat kanal penjualan" },
      { status: 500 }
    );
  }
}
