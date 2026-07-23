import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizePhone, requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/**
 * Pencarian member loyalty untuk penautan PIC (Fase D). pos_customers
 * global by design (EPIC-011) — bidang yang dikembalikan minimal saja,
 * di-rate-limit per user agar tidak bisa dipakai scraping member massal.
 */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  const rate = checkRateLimit(`sales-funnel-customers:${user.id}`, 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pencarian — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q.length < 3) return successResponse([]);

    const byPhone = normalizePhone(q);
    const rows = await query(
      `SELECT id, name, phone, membership_tier
       FROM pos.pos_customers
       WHERE is_active = true
         AND (name ILIKE $1 OR phone LIKE $2)
       ORDER BY name ASC
       LIMIT 10`,
      [`%${q}%`, `%${byPhone.length >= 5 ? byPhone : q}%`]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] search customers error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencari member" },
      { status: 500 }
    );
  }
}
