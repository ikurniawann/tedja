import { NextRequest, NextResponse } from "next/server";
import { createdResponse, paginatedResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { accountSchema } from "@/lib/sales-funnel/accounts";
import { validateCustomPayload, loadExistingCustom } from "@/lib/crm/custom-fields-server";
import {
  ACCOUNT_TYPES,
  isValidNormalizedPhone,
  normalizePhone,
  requireCompanyScope,
  requireSalesFunnelRole,
  resolveSalesVenue,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * EPIC-050 Fase 1 (T-1.3) — Accounts: instansi/perusahaan B2B.
 * Kolom agregat (jumlah contact/lead/deal terbuka, nilai menang) dihitung
 * lewat subquery skalar agar satu account = satu baris.
 */
const ACCOUNT_COLUMNS = `
  a.id, a.company_id, a.branch_id, a.name, a.account_type, a.industry,
  a.address, a.city, a.phone, a.email, a.website, a.npwp, a.notes,
  a.owner_user_id, a.custom, a.created_at, a.updated_at,
  u.full_name AS owner_name,
  (SELECT count(*) FROM crm.crm_contacts c WHERE c.account_id = a.id AND c.deleted_at IS NULL)::int AS contact_count,
  (SELECT count(*) FROM crm.crm_sales_leads l WHERE l.account_id = a.id AND l.deleted_at IS NULL)::int AS lead_count,
  (SELECT count(*) FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE l.account_id = a.id AND d.deleted_at IS NULL AND d.closed_at IS NULL)::int AS open_deal_count,
  (SELECT COALESCE(sum(COALESCE(d.value_final, d.value_estimate)), 0)
     FROM crm.crm_sales_deals d JOIN crm.crm_sales_stages s ON s.id = d.stage_id
     JOIN crm.crm_sales_leads l ON l.id = d.lead_id
     WHERE l.account_id = a.id AND d.deleted_at IS NULL AND s.is_won)::numeric AS won_value,
  (SELECT max(COALESCE(act.done_at, act.created_at)) FROM crm.crm_sales_activities act
     WHERE act.deleted_at IS NULL AND act.subject_type = 'account' AND act.subject_id = a.id) AS last_activity_at`;



export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const accountType = url.searchParams.get("account_type") ?? "";
    const owner = url.searchParams.get("owner_user_id") ?? "";
    const city = url.searchParams.get("city")?.trim() ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));

    const conditions: string[] = ["a.deleted_at IS NULL"];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      params.push(value);
      conditions.push(fragment.replace("?", `$${params.length}`));
    };
    if (scope?.companyId) add("a.company_id = ?", scope.companyId);
    if (scope?.businessScope === "branch" && scope.branchId) {
      add("a.branch_id = ?", scope.branchId);
    }
    // Role sales: account miliknya, tanpa owner, atau punya lead miliknya
    if (user.role === "sales") {
      add(
        `(a.owner_user_id = ? OR a.owner_user_id IS NULL
          OR EXISTS (SELECT 1 FROM crm.crm_sales_leads l
                      WHERE l.account_id = a.id AND l.deleted_at IS NULL AND l.owner_user_id = $${params.length + 1}))`,
        user.id
      );
    }
    if (accountType && (ACCOUNT_TYPES as readonly string[]).includes(accountType)) {
      add("a.account_type = ?", accountType);
    }
    if (owner && UUID_RE.test(owner)) add("a.owner_user_id = ?", owner);
    if (city) add("a.city ILIKE ?", `%${city}%`);
    if (q) {
      params.push(`%${q}%`);
      const idx = `$${params.length}`;
      conditions.push(
        `(a.name ILIKE ${idx} OR a.city ILIKE ${idx} OR a.phone ILIKE ${idx} OR a.email ILIKE ${idx}
          OR EXISTS (SELECT 1 FROM crm.crm_contacts c WHERE c.account_id = a.id AND c.deleted_at IS NULL
                      AND (c.name ILIKE ${idx} OR c.phone ILIKE ${idx})))`
      );
    }

    const where = conditions.join(" AND ");
    params.push(limit, (page - 1) * limit);
    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT ${ACCOUNT_COLUMNS}, COUNT(*) OVER() AS total_count
       FROM crm.crm_accounts a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       WHERE ${where}
       ORDER BY a.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const data = rows.map((row) => {
      const { total_count, ...rest } = row;
      void total_count;
      return rest;
    });
    return paginatedResponse(data, { page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("[sales-funnel] list accounts error:", err);
    return NextResponse.json({ success: false, error: "Gagal memuat accounts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const parsed = accountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;
    const { companyId, branchId } = await resolveSalesVenue(scope);
    if (!companyId || !branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user" },
        { status: 400 }
      );
    }
    let phone: string | null = null;
    if (body.phone) {
      phone = normalizePhone(body.phone);
      if (!isValidNormalizedPhone(phone)) {
        return NextResponse.json({ success: false, error: "Nomor telepon tidak valid" }, { status: 400 });
      }
    }
    if (user.role === "sales" && body.owner_user_id && body.owner_user_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "Role sales hanya boleh menjadi penanggung jawab sendiri" },
        { status: 403 }
      );
    }
    if (body.owner_user_id) {
      const ownerError = await validateAssignableOwner(body.owner_user_id, companyId);
      if (ownerError) return NextResponse.json({ success: false, error: ownerError }, { status: 400 });
    }
    const customCheck = await validateCustomPayload("account", companyId, body.custom);
    if (customCheck.error) return customCheck.error;
    const duplicate = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_accounts
       WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
      [companyId, body.name]
    );
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: "Account dengan nama ini sudah ada", account_id: duplicate.id },
        { status: 409 }
      );
    }
    const row = await queryOne(
      `INSERT INTO crm.crm_accounts
         (company_id, branch_id, name, account_type, industry, address, city, phone,
          email, website, npwp, notes, owner_user_id, custom, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
       RETURNING id, name, account_type, city, owner_user_id, created_at`,
      [
        companyId,
        branchId,
        body.name,
        body.account_type,
        body.industry || null,
        body.address || null,
        body.city || null,
        phone,
        body.email || null,
        body.website || null,
        body.npwp || null,
        body.notes || null,
        body.owner_user_id || (user.role === "sales" ? user.id : null),
        JSON.stringify(customCheck.values ?? {}),
        user.id,
      ]
    );
    return createdResponse(row, "Account dibuat");
  } catch (err) {
    console.error("[sales-funnel] create account error:", err);
    return NextResponse.json({ success: false, error: "Gagal membuat account" }, { status: 500 });
  }
}
