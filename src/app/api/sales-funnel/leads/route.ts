import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, paginatedResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import {
  LEAD_ORG_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  isValidNormalizedPhone,
  normalizePhone,
  requireCompanyScope,
  requireSalesFunnelRole,
  resolveSalesVenue,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEAD_COLUMNS = `
  l.id, l.company_id, l.branch_id, l.org_name, l.org_type, l.pic_name,
  l.pic_title, l.pic_phone, l.pic_email, l.city, l.source, l.temperature,
  l.status, l.notes, l.owner_user_id, l.customer_id, l.created_at,
  l.updated_at, u.full_name AS owner_name`;

const createLeadSchema = z.object({
  org_name: z.string().trim().min(1).max(200),
  org_type: z.enum(LEAD_ORG_TYPES).default("corporate"),
  pic_name: z.string().trim().min(1).max(150),
  pic_title: z.string().trim().max(100).optional().nullable(),
  pic_phone: z.string().trim().min(8).max(30),
  pic_email: z.string().trim().email().max(150).optional().nullable().or(z.literal("")),
  city: z.string().trim().max(100).optional().nullable(),
  source: z.enum(LEAD_SOURCES).default("lainnya"),
  temperature: z.enum(LEAD_TEMPERATURES).default("hangat"),
  status: z.enum(LEAD_STATUSES).default("baru"),
  notes: z.string().trim().max(2000).optional().nullable(),
  owner_user_id: z.string().uuid().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const status = url.searchParams.get("status") ?? "";
    const orgType = url.searchParams.get("org_type") ?? "";
    const source = url.searchParams.get("source") ?? "";
    const temperature = url.searchParams.get("temperature") ?? "";
    const owner = url.searchParams.get("owner_user_id") ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));

    const conditions: string[] = ["l.deleted_at IS NULL"];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      params.push(value);
      conditions.push(fragment.replace("?", `$${params.length}`));
    };

    // Scope bisnis: holding/super tanpa scope melihat semua; company/branch
    // dibatasi ke venuenya (pola importBusinessIds — branch hanya utk scope branch)
    if (scope?.companyId) add("l.company_id = ?", scope.companyId);
    if (scope?.businessScope === "branch" && scope.branchId) {
      add("l.branch_id = ?", scope.branchId);
    }
    // Role sales hanya melihat lead miliknya ATAU tanpa owner (unassigned)
    if (user.role === "sales") {
      add("(l.owner_user_id = ? OR l.owner_user_id IS NULL)", user.id);
    }
    if (status && (LEAD_STATUSES as readonly string[]).includes(status)) {
      add("l.status = ?", status);
    }
    if (orgType && (LEAD_ORG_TYPES as readonly string[]).includes(orgType)) {
      add("l.org_type = ?", orgType);
    }
    if (source && (LEAD_SOURCES as readonly string[]).includes(source)) {
      add("l.source = ?", source);
    }
    if (temperature && (LEAD_TEMPERATURES as readonly string[]).includes(temperature)) {
      add("l.temperature = ?", temperature);
    }
    if (owner && UUID_RE.test(owner)) add("l.owner_user_id = ?", owner);
    if (q) {
      params.push(`%${q}%`);
      const idx = `$${params.length}`;
      conditions.push(
        `(l.org_name ILIKE ${idx} OR l.pic_name ILIKE ${idx} OR l.pic_phone ILIKE ${idx})`
      );
    }

    const where = conditions.join(" AND ");
    params.push(limit, (page - 1) * limit);
    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT ${LEAD_COLUMNS}, COUNT(*) OVER() AS total_count
       FROM crm.crm_sales_leads l
       LEFT JOIN configuration.users u ON u.id = l.owner_user_id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const data = rows.map(({ total_count: _total, ...lead }) => lead);
    return paginatedResponse(data, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[sales-funnel] list leads error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat leads" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const parsed = createLeadSchema.safeParse(await request.json());
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
        {
          success: false,
          error:
            "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user",
        },
        { status: 400 }
      );
    }

    const phone = normalizePhone(body.pic_phone);
    if (!isValidNormalizedPhone(phone)) {
      return NextResponse.json(
        { success: false, error: "No. WA PIC tidak valid" },
        { status: 400 }
      );
    }
    // Role sales tidak boleh mengalihkan kepemilikan ke user lain
    if (
      user.role === "sales" &&
      body.owner_user_id &&
      body.owner_user_id !== user.id
    ) {
      return NextResponse.json(
        { success: false, error: "Role sales hanya boleh menjadi penanggung jawab sendiri" },
        { status: 403 }
      );
    }
    if (body.owner_user_id) {
      const ownerError = await validateAssignableOwner(body.owner_user_id, companyId);
      if (ownerError) {
        return NextResponse.json(
          { success: false, error: ownerError },
          { status: 400 }
        );
      }
    }

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM crm.crm_sales_leads
       WHERE company_id = $1 AND pic_phone = $2 AND deleted_at IS NULL`,
      [companyId, phone]
    );
    if (existing) {
      return NextResponse.json(
        { success: false, error: "Lead dengan no. WA PIC ini sudah ada" },
        { status: 409 }
      );
    }

    const row = await queryOne(
      `INSERT INTO crm.crm_sales_leads
         (company_id, branch_id, org_name, org_type, pic_name, pic_title,
          pic_phone, pic_email, city, source, temperature, status, notes,
          owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id, org_name, pic_name, pic_phone, status`,
      [
        companyId,
        branchId,
        body.org_name,
        body.org_type,
        body.pic_name,
        body.pic_title || null,
        phone,
        body.pic_email || null,
        body.city || null,
        body.source,
        body.temperature,
        body.status,
        body.notes || null,
        body.owner_user_id || (user.role === "sales" ? user.id : null),
        user.id,
      ]
    );

    return createdResponse(row, "Lead berhasil dibuat");
  } catch (err) {
    console.error("[sales-funnel] create lead error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat lead" },
      { status: 500 }
    );
  }
}
