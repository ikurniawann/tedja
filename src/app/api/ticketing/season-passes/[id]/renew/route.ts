import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";
import { todayInJakarta } from "@/lib/ticketing/booking";
import { addMonthsIso } from "@/lib/ticketing/season-pass";

// EPIC-028 Fase D — perpanjang Season Pass (renewal di loket). valid_until
// diperpanjang validity_months dari MAX(hari ini, valid_until saat ini) — pass
// yang belum habis menambah sisa, yang sudah habis mulai dari hari ini.
// Punch-card → jatah kunjungan di-reset penuh.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const { id } = await params;
    const pass = await queryOne<{
      status: string;
      entry_policy: string;
      valid_until: string | null;
      validity_months: number;
      visit_quota: number | null;
    }>(
      `SELECT sp.status, sp.entry_policy, sp.valid_until::text AS valid_until,
              pc.validity_months, pc.visit_quota
       FROM ticketing.ticket_season_passes sp
       JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = sp.ticket_product_id
       WHERE sp.id = $1 AND sp.branch_id = $2 AND sp.company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!pass) {
      return NextResponse.json(
        { success: false, error: "Pass tidak ditemukan" },
        { status: 404 }
      );
    }
    if (pass.status === "cancelled") {
      return NextResponse.json(
        { success: false, error: "Pass dibatalkan — tidak bisa diperpanjang" },
        { status: 400 }
      );
    }
    if (pass.status === "pending") {
      return NextResponse.json(
        { success: false, error: "Pass belum aktif (menunggu pembayaran)" },
        { status: 400 }
      );
    }

    const today = todayInJakarta();
    const base =
      pass.valid_until && pass.valid_until > today ? pass.valid_until : today;
    const newValidUntil = addMonthsIso(base, pass.validity_months);
    const resetQuota = pass.entry_policy === "limited_visits";

    await query(
      `UPDATE ticketing.ticket_season_passes
       SET valid_until = $2,
           valid_from = COALESCE(valid_from, $3),
           status = 'active',
           activated_at = COALESCE(activated_at, now()),
           visit_quota_total = CASE WHEN $4 THEN $5 ELSE visit_quota_total END,
           visit_quota_used = CASE WHEN $4 THEN 0 ELSE visit_quota_used END,
           updated_at = now()
       WHERE id = $1`,
      [id, newValidUntil, today, resetQuota, pass.visit_quota]
    );

    return successResponse(
      { id, valid_until: newValidUntil, quota_reset: resetQuota },
      `Pass diperpanjang s/d ${newValidUntil}`
    );
  } catch (err) {
    console.error("[ticketing] renew pass error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperpanjang pass" },
      { status: 500 }
    );
  }
}
