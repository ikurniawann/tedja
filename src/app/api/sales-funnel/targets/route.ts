import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import { monthRange, targetSchema } from "@/lib/sales-funnel/forecast";
import { requireCompanyScope, requireSalesFunnelRole, resolveSalesVenue } from "@/lib/sales-funnel/server";

/** EPIC-050 T-3.2 — target per salesperson per bulan. GET ?month=YYYY-MM · PUT { targets: [...] } */
export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  const scope = await getApiUserScope();
  const scopeError = requireCompanyScope(user, scope);
  if (scopeError) return scopeError;
  const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ success: false, error: "month: YYYY-MM" }, { status: 400 });
  const { from } = monthRange(month);
  const rows = await query(
    `SELECT t.id, t.user_id, u.full_name, t.period_month::text AS period_month, t.target_value, t.target_deals, t.pipeline_id
     FROM crm.crm_sales_targets t JOIN configuration.users u ON u.id = t.user_id
     WHERE t.period_month = $1::date AND ($2::uuid IS NULL OR t.company_id = $2)
       ${user.role === "sales" ? "AND t.user_id = $3" : ""}
     ORDER BY u.full_name`,
    user.role === "sales" ? [from, scope?.companyId ?? null, user.id] : [from, scope?.companyId ?? null]
  );
  return successResponse(rows);
}

const putSchema = z.object({ targets: z.array(targetSchema).min(1).max(200) });

export async function PUT(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  if (user.role === "sales") return NextResponse.json({ success: false, error: "Target ditetapkan admin/super admin" }, { status: 403 });
  const scope = await getApiUserScope();
  const scopeError = requireCompanyScope(user, scope);
  if (scopeError) return scopeError;
  const { companyId } = await resolveSalesVenue(scope);
  if (!companyId) return NextResponse.json({ success: false, error: "Venue belum dikonfigurasi" }, { status: 400 });
  const parsed = putSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  let saved = 0;
  for (const t of parsed.data.targets) {
    const { from } = monthRange(t.period_month);
    await query(
      `INSERT INTO crm.crm_sales_targets (company_id, user_id, period_month, target_value, target_deals, pipeline_id, created_by)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (company_id, user_id, period_month, COALESCE(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET target_value = EXCLUDED.target_value, target_deals = EXCLUDED.target_deals, updated_at = now()`,
      [companyId, t.user_id, from, t.target_value, t.target_deals ?? null, t.pipeline_id ?? null, user.id]
    );
    saved += 1;
  }
  return successResponse({ saved }, `${saved} target disimpan`);
}
