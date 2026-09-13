import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { aggregateForecast, monthRange, sumForecast, type ForecastDealRow } from "@/lib/sales-funnel/forecast";
import { requireCompanyScope, requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/**
 * EPIC-050 T-3.2 — GET ?month=YYYY-MM[&pipeline_id=]
 * Periode deal: menang → closed_at di bulan tsb; terbuka → event_date di bulan tsb,
 * fallback bulan dibuat bila event_date kosong. Weighted = Σ nilai × probability tahap.
 */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  const scope = await getApiUserScope();
  const scopeError = requireCompanyScope(user, scope);
  if (scopeError) return scopeError;
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ success: false, error: "month: YYYY-MM" }, { status: 400 });
  const pipelineId = url.searchParams.get("pipeline_id");
  const { from, to } = monthRange(month);
  const params: unknown[] = [from, to, scope?.companyId ?? null];
  let extra = "";
  if (pipelineId && /^[0-9a-f-]{36}$/i.test(pipelineId)) {
    params.push(pipelineId);
    extra += ` AND d.pipeline_id = $${params.length}`;
  }
  if (user.role === "sales") {
    params.push(user.id);
    extra += ` AND (d.owner_user_id = $${params.length} OR d.owner_user_id IS NULL)`;
  }
  const deals = await query<ForecastDealRow & { deal_id: string; title: string; org_name: string; stage_name: string; event_date: string | null }>(
    `SELECT d.id AS deal_id, d.title, l.org_name, d.owner_user_id, u.full_name AS owner_name, d.pipeline_id,
            COALESCE(d.value_final, d.value_estimate, 0)::numeric AS value,
            s.probability, s.name AS stage_name, d.event_date::text AS event_date,
            CASE WHEN s.is_won THEN 'closed_won' WHEN s.is_lost THEN 'closed_lost' ELSE d.forecast_category END AS category
     FROM crm.crm_sales_deals d
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     LEFT JOIN configuration.users u ON u.id = d.owner_user_id
     WHERE d.deleted_at IS NULL
       AND ($3::uuid IS NULL OR d.company_id = $3)
       AND (
         (s.is_won AND d.closed_at >= $1::date AND d.closed_at < $2::date)
         OR (NOT s.is_won AND NOT s.is_lost AND COALESCE(d.event_date, d.created_at::date) >= $1::date AND COALESCE(d.event_date, d.created_at::date) < $2::date)
       )${extra}
     ORDER BY d.event_date NULLS LAST`,
    params
  );
  const targets = await query<{ user_id: string; target_value: number; target_deals: number | null }>(
    `SELECT user_id, target_value, target_deals FROM crm.crm_sales_targets
     WHERE period_month = $1::date AND ($2::uuid IS NULL OR company_id = $2)
       AND ($3::uuid IS NULL OR pipeline_id IS NULL OR pipeline_id = $3)`,
    [from, scope?.companyId ?? null, pipelineId && /^[0-9a-f-]{36}$/i.test(pipelineId) ? pipelineId : null]
  );
  const users = await query<{ id: string; name: string }>(
    `SELECT id, full_name AS name FROM configuration.users
     WHERE status = 'active' AND role IN ('sales', 'admin', 'super_admin') AND ($1::uuid IS NULL OR company_id IS NULL OR company_id = $1)
       ${user.role === "sales" ? "AND id = $2" : ""}
     ORDER BY full_name`,
    user.role === "sales" ? [scope?.companyId ?? null, user.id] : [scope?.companyId ?? null]
  );
  const rows = aggregateForecast(
    deals.map((d) => ({ ...d, value: Number(d.value) })),
    targets.map((t) => ({ ...t, target_value: Number(t.target_value) })),
    users
  );
  return successResponse({
    month,
    rows,
    total: sumForecast(rows),
    deals: deals.map((d) => ({ id: d.deal_id, title: d.title, org_name: d.org_name, owner_user_id: d.owner_user_id, owner_name: d.owner_name,
      value: Number(d.value), probability: d.probability, category: d.category, stage_name: d.stage_name, event_date: d.event_date, pipeline_id: d.pipeline_id })),
  });
}
