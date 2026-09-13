import { NextRequest, NextResponse } from "next/server";
import { createdResponse, paginatedResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import { findAccessibleAccount } from "@/lib/sales-funnel/access";
import { contactSchema } from "@/lib/sales-funnel/accounts";
import { validateCustomPayload, loadExistingCustom } from "@/lib/crm/custom-fields-server";
import {
  isValidNormalizedPhone,
  normalizePhone,
  requireCompanyScope,
  requireSalesFunnelRole,
  resolveSalesVenue,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** EPIC-050 Fase 1 (T-1.3) — Contacts: PIC lintas account. */
const CONTACT_COLUMNS = `
  c.id, c.company_id, c.branch_id, c.account_id, c.name, c.title, c.phone, c.email,
  c.is_primary, c.customer_id, c.notes, c.owner_user_id, c.custom, c.created_at, c.updated_at,
  a.name AS account_name, a.account_type,
  u.full_name AS owner_name,
  (SELECT count(*) FROM crm.crm_sales_leads l WHERE l.contact_id = c.id AND l.deleted_at IS NULL)::int AS lead_count,
  (SELECT max(COALESCE(act.done_at, act.created_at)) FROM crm.crm_sales_activities act
     WHERE act.deleted_at IS NULL AND act.subject_type = 'contact' AND act.subject_id = c.id) AS last_activity_at`;

export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const accountId = url.searchParams.get("account_id") ?? "";
    const owner = url.searchParams.get("owner_user_id") ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));

    const conditions: string[] = ["c.deleted_at IS NULL"];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      params.push(value);
      conditions.push(fragment.replace("?", `$${params.length}`));
    };
    if (scope?.companyId) add("c.company_id = ?", scope.companyId);
    if (scope?.businessScope === "branch" && scope.branchId) add("c.branch_id = ?", scope.branchId);
    if (user.role === "sales") {
      add(
        `(c.owner_user_id = ? OR c.owner_user_id IS NULL
          OR EXISTS (SELECT 1 FROM crm.crm_sales_leads l
                      WHERE l.contact_id = c.id AND l.deleted_at IS NULL AND l.owner_user_id = $${params.length + 1}))`,
        user.id
      );
    }
    if (accountId && UUID_RE.test(accountId)) add("c.account_id = ?", accountId);
    if (owner && UUID_RE.test(owner)) add("c.owner_user_id = ?", owner);
    if (q) {
      params.push(`%${q}%`);
      const idx = `$${params.length}`;
      conditions.push(
        `(c.name ILIKE ${idx} OR c.phone ILIKE ${idx} OR c.email ILIKE ${idx} OR c.title ILIKE ${idx} OR a.name ILIKE ${idx})`
      );
    }
    const where = conditions.join(" AND ");
    params.push(limit, (page - 1) * limit);
    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT ${CONTACT_COLUMNS}, COUNT(*) OVER() AS total_count
       FROM crm.crm_contacts c
       LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
       LEFT JOIN configuration.users u ON u.id = c.owner_user_id
       WHERE ${where}
       ORDER BY c.updated_at DESC
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
    console.error("[sales-funnel] list contacts error:", err);
    return NextResponse.json({ success: false, error: "Gagal memuat contacts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  try {
    const parsed = contactSchema.safeParse(await request.json());
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

    // Venue: dari account bila ada (sekaligus cek akses), else venue user
    let companyId: string | null;
    let branchId: string | null;
    if (body.account_id) {
      const { account, forbidden } = await findAccessibleAccount(body.account_id, user);
      if (forbidden || !account) {
        return NextResponse.json(
          { success: false, error: forbidden ? "Insufficient permissions" : "Account tidak ditemukan" },
          { status: forbidden ? 403 : 404 }
        );
      }
      companyId = account.company_id;
      branchId = account.branch_id;
    } else {
      const resolved = await resolveSalesVenue(scope);
      companyId = resolved.companyId;
      branchId = resolved.branchId;
    }
    if (!companyId || !branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi — lengkapi scope bisnis user atau venue default CRM" },
        { status: 400 }
      );
    }
    const phone = normalizePhone(body.phone);
    if (!isValidNormalizedPhone(phone)) {
      return NextResponse.json({ success: false, error: "Nomor WA tidak valid" }, { status: 400 });
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
    const customCheck = await validateCustomPayload("contact", companyId, body.custom);
    if (customCheck.error) return customCheck.error;
    const duplicate = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM crm.crm_contacts WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL`,
      [companyId, phone]
    );
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: `Nomor ini sudah terdaftar atas nama ${duplicate.name}`, contact_id: duplicate.id },
        { status: 409 }
      );
    }
    if (body.is_primary && body.account_id) {
      await query(
        `UPDATE crm.crm_contacts SET is_primary = false, updated_at = now()
         WHERE account_id = $1 AND deleted_at IS NULL`,
        [body.account_id]
      );
    }
    const row = await queryOne(
      `INSERT INTO crm.crm_contacts
         (company_id, branch_id, account_id, name, title, phone, email, is_primary,
          customer_id, notes, owner_user_id, custom, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
       RETURNING id, account_id, name, phone, is_primary, created_at`,
      [
        companyId,
        branchId,
        body.account_id ?? null,
        body.name,
        body.title || null,
        phone,
        body.email || null,
        body.is_primary,
        body.customer_id ?? null,
        body.notes || null,
        body.owner_user_id || (user.role === "sales" ? user.id : null),
        JSON.stringify(customCheck.values ?? {}),
        user.id,
      ]
    );
    return createdResponse(row, "Contact dibuat");
  } catch (err) {
    console.error("[sales-funnel] create contact error:", err);
    return NextResponse.json({ success: false, error: "Gagal membuat contact" }, { status: 500 });
  }
}
