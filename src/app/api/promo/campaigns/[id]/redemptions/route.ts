import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requirePromoContext } from "@/lib/promo/server";

// EPIC-032 A3 — riwayat pemakaian satu campaign (100 terbaru).

interface RedemptionRow {
  id: string;
  code: string;
  context_type: string;
  context_id: string;
  phone: string | null;
  discount_amount: string;
  status: "held" | "captured" | "released";
  created_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requirePromoContext();
  if (error) return error;

  try {
    const { id } = await params;
    const campaign = await queryOne<{ id: string }>(
      `SELECT id FROM promo.promo_campaigns
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: "Campaign tidak ditemukan" },
        { status: 404 }
      );
    }
    const rows = await query<RedemptionRow>(
      `SELECT r.id, k.code, r.context_type, r.context_id, r.phone,
              r.discount_amount, r.status, r.created_at
       FROM promo.promo_redemptions r
       JOIN promo.promo_codes k ON k.id = r.code_id
       WHERE r.campaign_id = $1
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [id]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[promo] list redemptions error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat riwayat pemakaian" },
      { status: 500 }
    );
  }
}
