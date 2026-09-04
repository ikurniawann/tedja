import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { apiErrorResponse, toNumber } from "@/lib/crm/server";
import {
  mapFrequentVisitorRow,
  mapTopSpenderRow,
  mapVenueReconciliationRow,
  requireCrmReportRole,
  resolveReportPeriod,
  sumReconciliation,
} from "@/lib/crm/reports";

const LEADERBOARD_LIMIT = 20;

// Order dianggap belanja bila sudah dibayar dan tidak dibatalkan/void —
// keputusan owner #11: top spender = nilai belanja/order (semua metode),
// topup TIDAK dihitung.
const PAID_ORDER_FILTER = `
  o.payment_status = 'paid'
  AND (o.status IS NULL OR o.status NOT IN ('cancelled', 'voided'))
  AND o.customer_id IS NOT NULL
  AND o.created_at >= $1 AND o.created_at < $2
`;

export async function GET(request: NextRequest) {
  const guard = await requireCrmReportRole();
  if (guard) return guard;

  const { searchParams } = new URL(request.url);
  const period = resolveReportPeriod(searchParams.get("from"), searchParams.get("to"));
  if (!period) {
    return NextResponse.json(
      { success: false, error: "Periode tidak valid (format YYYY-MM-DD, from <= to, maksimal 366 hari)" },
      { status: 400 }
    );
  }

  try {
    const periodParams = [period.fromIso, period.toIso];

    const [topSpenderRows, frequentVisitorRows, reconciliationRows, untaggedRow, summaryRow] = await Promise.all([
      query(
        `SELECT c.id, c.name, c.phone, c.membership_tier, c.member_type,
                COUNT(o.id) AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS total_spend,
                COALESCE(SUM(o.ark_coins_used), 0) AS ark_spend,
                MAX(o.created_at) AS last_order_at
         FROM pos.pos_orders o
         JOIN pos.pos_customers c ON c.id = o.customer_id
         WHERE ${PAID_ORDER_FILTER}
         GROUP BY c.id
         ORDER BY total_spend DESC
         LIMIT ${LEADERBOARD_LIMIT}`,
        periodParams
      ),
      query(
        `SELECT c.id, c.name, c.phone, c.membership_tier, c.member_type,
                COUNT(o.id) AS order_count,
                COUNT(DISTINCT (o.created_at AT TIME ZONE 'Asia/Jakarta')::date) AS visit_days,
                MAX(o.created_at) AS last_visit_at,
                c.visit_count AS lifetime_visits
         FROM pos.pos_orders o
         JOIN pos.pos_customers c ON c.id = o.customer_id
         WHERE ${PAID_ORDER_FILTER}
         GROUP BY c.id
         ORDER BY visit_days DESC, order_count DESC
         LIMIT ${LEADERBOARD_LIMIT}`,
        periodParams
      ),
      query(
        `SELECT w.company_id, w.branch_id,
                co.name AS company_name,
                br.name AS branch_name,
                -- Topup berbayar (kas masuk) dipisah dari FOC (gratis/marketing).
                COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup' AND COALESCE(w.payment_method, '') <> 'foc'), 0) AS topup_amount,
                COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup' AND w.payment_method = 'foc'), 0) AS foc_topup_amount,
                COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'topup_bonus'), 0) AS bonus_amount,
                COALESCE(SUM(w.amount) FILTER (WHERE w.type = 'payment'), 0) AS spend_amount,
                COALESCE(SUM(w.amount) FILTER (WHERE w.type NOT IN ('topup', 'topup_bonus', 'payment')), 0) AS other_amount,
                COUNT(*) FILTER (WHERE w.type = 'topup' AND COALESCE(w.payment_method, '') <> 'foc') AS topup_count,
                COUNT(*) FILTER (WHERE w.type = 'topup' AND w.payment_method = 'foc') AS foc_topup_count,
                COUNT(*) FILTER (WHERE w.type = 'payment') AS payment_count
         FROM pos.pos_wallet_transactions w
         LEFT JOIN configuration.companies co ON co.id = w.company_id
         LEFT JOIN configuration.branches br ON br.id = w.branch_id
         WHERE w.created_at >= $1 AND w.created_at < $2
           -- Transaksi tanpa venue (company_id kosong) tidak bisa
           -- direkonsiliasi antar-venue, jadi tidak ditampilkan
           -- (permintaan owner 2026-09-01). Nilainya tetap dilaporkan
           -- terpisah lewat untagged_* di bawah supaya tidak hilang senyap.
           AND w.company_id IS NOT NULL
         GROUP BY w.company_id, w.branch_id, co.name, br.name
         ORDER BY topup_amount DESC, spend_amount DESC`,
        periodParams
      ),
      queryOne(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE type = 'topup' AND COALESCE(payment_method, '') <> 'foc'), 0) AS topup_amount,
           COUNT(*) FILTER (WHERE type = 'topup' AND COALESCE(payment_method, '') <> 'foc') AS topup_count
         FROM pos.pos_wallet_transactions
         WHERE created_at >= $1 AND created_at < $2 AND company_id IS NULL`,
        periodParams
      ),
      queryOne(
        `SELECT
           (SELECT COALESCE(SUM(ark_coin_balance), 0) FROM pos.pos_customers WHERE is_active) AS outstanding_balance,
           (SELECT COUNT(*) FROM pos.pos_customers WHERE is_active AND member_type = 'card') AS card_members,
           (SELECT COUNT(*) FROM pos.pos_customers WHERE is_active AND member_type = 'registered') AS registered_members`
      ),
    ]);

    const reconciliation = reconciliationRows.map(mapVenueReconciliationRow);

    return NextResponse.json({
      success: true,
      data: {
        period: { from: period.fromDate, to: period.toDate },
        topSpenders: topSpenderRows.map(mapTopSpenderRow),
        frequentVisitors: frequentVisitorRows.map(mapFrequentVisitorRow),
        reconciliation: {
          venues: reconciliation,
          totals: sumReconciliation(reconciliation),
          // Saldo ARK beredar = liabilitas platform saat ini (bukan per periode).
          outstanding_balance: toNumber(summaryRow?.outstanding_balance),
          // Topup yang belum bertanda venue: tidak masuk tabel per-venue,
          // tapi tetap dilaporkan agar kasnya tidak hilang dari pandangan.
          untagged_topup_amount: toNumber(untaggedRow?.topup_amount),
          untagged_topup_count: toNumber(untaggedRow?.topup_count),
        },
        members: {
          card: toNumber(summaryRow?.card_members),
          registered: toNumber(summaryRow?.registered_members),
        },
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Gagal memuat laporan CRM");
  }
}
