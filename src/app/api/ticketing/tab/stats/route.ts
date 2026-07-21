import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

/** Tab monitor live: ringkasan kunjungan berjalan untuk halaman loket. */
export async function GET() {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const stats = await queryOne<{
      open_visits: string;
      open_bands: string;
      outstanding_total: string;
      saldo_total: string;
    }>(
      `SELECT
         COUNT(*) AS open_visits,
         COALESCE(SUM((SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
           WHERE vb.visit_id = v.id AND vb.status = 'aktif')), 0) AS open_bands,
         COALESCE(SUM(CASE WHEN v.payment_mode = 'postpaid' THEN GREATEST(bal.net, 0) END), 0)
           AS outstanding_total,
         COALESCE(SUM(CASE WHEN v.payment_mode = 'prepaid' THEN GREATEST(-bal.net, 0) END), 0)
           AS saldo_total
       FROM ticketing.ticket_visits v
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(CASE WHEN c.direction = 'debit' THEN c.amount
                                  ELSE -c.amount END), 0) AS net
         FROM ticketing.ticket_visit_charges c
         WHERE c.visit_id = v.id
       ) bal
       WHERE v.branch_id = $1 AND v.company_id = $2 AND v.status = 'open'`,
      [ctx.branchId, ctx.companyId]
    );

    return successResponse({
      open_visits: Number(stats?.open_visits ?? 0),
      open_bands: Number(stats?.open_bands ?? 0),
      outstanding_total: Number(stats?.outstanding_total ?? 0),
      saldo_total: Number(stats?.saldo_total ?? 0),
    });
  } catch (err) {
    console.error("[ticketing] tab stats error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat statistik tab" },
      { status: 500 }
    );
  }
}
