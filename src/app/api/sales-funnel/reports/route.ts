import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import {
  requireCompanyScope,
  requireSalesFunnelRole,
  type SalesFunnelUser,
} from "@/lib/sales-funnel/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_PERIOD_DAYS = 90;

/**
 * Fragmen scope (company/branch + sales own-or-unassigned) dengan posisi
 * placeholder menyesuaikan jumlah parameter yang sudah ada di query.
 */
function buildScope(
  user: SalesFunnelUser,
  scope: UserScope | null,
  startIndex: number
): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (fragment: string, value: unknown) => {
    params.push(value);
    conditions.push(fragment.replace("?", `$${startIndex + params.length - 1}`));
  };
  if (scope?.companyId) add("d.company_id = ?", scope.companyId);
  if (scope?.businessScope === "branch" && scope.branchId) {
    add("d.branch_id = ?", scope.branchId);
  }
  if (user.role === "sales") {
    add("(d.owner_user_id = ? OR d.owner_user_id IS NULL)", user.id);
  }
  return {
    sql: conditions.length ? `AND ${conditions.join(" AND ")}` : "",
    params,
  };
}

/**
 * Laporan Funnel (EPIC-022 Fase E). Satu endpoint agregat:
 * - funnel: deal yang PERNAH mencapai tiap tahap (stage_history) di antara
 *   deal yang DIBUAT dalam periode → % konversi antar tahap dihitung client
 * - ringkasan: win rate & nilai booking (deal DITUTUP dalam periode),
 *   nilai pipeline berjalan (snapshot saat ini, tidak terikat periode)
 * - breakdown per jenis instansi / acara / sumber / penanggung jawab
 * - kalender acara ter-booking ke depan + rekap alasan kalah
 */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;

    const url = new URL(request.url);
    const fromParam = url.searchParams.get("from") ?? "";
    const toParam = url.searchParams.get("to") ?? "";
    let from = DATE_RE.test(fromParam)
      ? fromParam
      : new Date(Date.now() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
    let to = DATE_RE.test(toParam) ? toParam : new Date().toISOString().slice(0, 10);
    // Rentang terbalik ditukar diam-diam — laporan kosong palsu lebih
    // menyesatkan daripada menoleransi input tertukar
    if (from > to) [from, to] = [to, from];

    // Query berperiode: $1=from, $2=to, scope mulai $3
    const periodScope = buildScope(user, scope, 3);
    const periodParams = [from, to, ...periodScope.params];
    const createdInPeriod = `
      d.deleted_at IS NULL
      AND d.created_at >= $1::date AND d.created_at < ($2::date + 1)
      ${periodScope.sql}`;
    const closedInPeriod = `
      d.deleted_at IS NULL
      AND d.closed_at >= $1::date AND d.closed_at < ($2::date + 1)
      ${periodScope.sql}`;

    // Query snapshot (tanpa periode): scope mulai $1
    const nowScope = buildScope(user, scope, 1);

    const [
      funnel,
      closedSummary,
      totalCreated,
      pipelineNow,
      byOrgType,
      byEventType,
      bySource,
      byOwner,
      upcomingEvents,
      lostReasons,
    ] = await Promise.all([
      query(
        `SELECT s.id, s.name, s.code, s.sort_order, s.is_won,
                COUNT(DISTINCT h.deal_id) AS reached
         FROM crm.crm_sales_stages s
         LEFT JOIN crm.crm_sales_deal_stage_history h ON h.stage_id = s.id
           AND h.deal_id IN (
             SELECT d.id FROM crm.crm_sales_deals d WHERE ${createdInPeriod}
           )
         WHERE s.is_active = true AND s.is_lost = false
         GROUP BY s.id, s.name, s.code, s.sort_order, s.is_won
         ORDER BY s.sort_order ASC`,
        periodParams
      ),
      queryOne<{ won: string; lost: string; won_value: string | null }>(
        `SELECT COUNT(*) FILTER (WHERE s.is_won) AS won,
                COUNT(*) FILTER (WHERE s.is_lost) AS lost,
                SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE ${closedInPeriod}`,
        periodParams
      ),
      queryOne<{ total: string }>(
        `SELECT COUNT(*) AS total FROM crm.crm_sales_deals d
         WHERE ${createdInPeriod}`,
        periodParams
      ),
      queryOne<{ open_count: string; pipeline_value: string | null }>(
        `SELECT COUNT(*) AS open_count,
                SUM(COALESCE(d.value_final, d.value_estimate)) AS pipeline_value
         FROM crm.crm_sales_deals d
         WHERE d.deleted_at IS NULL AND d.closed_at IS NULL ${nowScope.sql}`,
        nowScope.params
      ),
      query(
        `SELECT l.org_type AS key, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE s.is_won) AS won,
                SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_leads l ON l.id = d.lead_id
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE ${createdInPeriod}
         GROUP BY l.org_type ORDER BY total DESC`,
        periodParams
      ),
      query(
        `SELECT d.event_type AS key, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE s.is_won) AS won,
                SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE ${createdInPeriod}
         GROUP BY d.event_type ORDER BY total DESC`,
        periodParams
      ),
      query(
        `SELECT l.source AS key, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE s.is_won) AS won,
                SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_leads l ON l.id = d.lead_id
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE ${createdInPeriod}
         GROUP BY l.source ORDER BY total DESC`,
        periodParams
      ),
      query(
        `SELECT COALESCE(u.full_name, 'Tanpa PJ') AS key, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE s.is_won) AS won,
                SUM(d.value_final) FILTER (WHERE s.is_won) AS won_value
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN configuration.users u ON u.id = d.owner_user_id
         WHERE ${createdInPeriod}
         GROUP BY COALESCE(u.full_name, 'Tanpa PJ')
         ORDER BY won DESC, total DESC
         LIMIT 15`,
        periodParams
      ),
      query(
        `SELECT d.id, d.title, d.event_type, d.event_date, d.pax_estimate,
                d.value_final, l.org_name, l.pic_name, l.pic_phone
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_leads l ON l.id = d.lead_id
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         WHERE d.deleted_at IS NULL AND s.is_won = true
           AND d.event_date >= CURRENT_DATE ${nowScope.sql}
         ORDER BY d.event_date ASC
         LIMIT 20`,
        nowScope.params
      ),
      query(
        `SELECT COALESCE(lr.name, 'Tanpa alasan') AS key, COUNT(*) AS total
         FROM crm.crm_sales_deals d
         JOIN crm.crm_sales_stages s ON s.id = d.stage_id
         LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
         WHERE s.is_lost = true AND ${closedInPeriod}
         GROUP BY COALESCE(lr.name, 'Tanpa alasan')
         ORDER BY total DESC`,
        periodParams
      ),
    ]);

    return successResponse({
      period: { from, to },
      funnel,
      summary: {
        total_created: Number(totalCreated?.total ?? 0),
        won: Number(closedSummary?.won ?? 0),
        lost: Number(closedSummary?.lost ?? 0),
        won_value: closedSummary?.won_value ?? null,
        open_count: Number(pipelineNow?.open_count ?? 0),
        pipeline_value: pipelineNow?.pipeline_value ?? null,
      },
      by_org_type: byOrgType,
      by_event_type: byEventType,
      by_source: bySource,
      by_owner: byOwner,
      upcoming_events: upcomingEvents,
      lost_reasons: lostReasons,
    });
  } catch (err) {
    console.error("[sales-funnel] reports error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat laporan" },
      { status: 500 }
    );
  }
}
