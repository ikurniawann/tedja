import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query } from "@/lib/db";
import {
  findAccessibleDeal,
  findAccessibleLead,
} from "@/lib/sales-funnel/access";
import {
  ACTIVITY_TYPES,
  requireCompanyScope,
  requireSalesFunnelRole,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

// Agenda tidak dipaginasi (list harian) — pagar sama dengan kanban deals
const MAX_AGENDA_ROWS = 300;

const ACTIVITY_COLUMNS = `
  a.id, a.lead_id, a.deal_id, a.activity_type, a.notes, a.due_at, a.done_at,
  a.owner_user_id, a.reminder_sent_at, a.created_at,
  u.full_name AS owner_name,
  d.title AS deal_title,
  COALESCE(dl.org_name, l.org_name) AS org_name,
  COALESCE(dl.pic_name, l.pic_name) AS pic_name,
  COALESCE(dl.pic_phone, l.pic_phone) AS pic_phone`;

const ACTIVITY_JOINS = `
  FROM crm.crm_sales_activities a
  LEFT JOIN configuration.users u ON u.id = a.owner_user_id
  LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
  LEFT JOIN crm.crm_sales_leads dl ON dl.id = d.lead_id
  LEFT JOIN crm.crm_sales_leads l ON l.id = a.lead_id`;

const createActivitySchema = z
  .object({
    deal_id: z.string().uuid().optional().nullable(),
    lead_id: z.string().uuid().optional().nullable(),
    activity_type: z.enum(ACTIVITY_TYPES).default("catatan"),
    notes: z.string().trim().max(2000).optional().nullable(),
    due_at: z.string().datetime({ offset: true }).optional().nullable(),
    owner_user_id: z.string().uuid().optional().nullable(),
    is_done: z.boolean().default(false),
  })
  .refine((v) => v.deal_id || v.lead_id, {
    message: "Aktivitas harus terkait deal atau lead",
  });

export async function GET(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const dealId = url.searchParams.get("deal_id");
    const leadId = url.searchParams.get("lead_id");
    const view = url.searchParams.get("view");

    // ── Timeline satu deal/lead: akses dicek lewat induknya ──
    if (dealId || leadId) {
      if (dealId) {
        const { deal, forbidden } = await findAccessibleDeal(dealId, user);
        if (forbidden || !deal) {
          return NextResponse.json(
            { success: false, error: forbidden ? "Insufficient permissions" : "Deal tidak ditemukan" },
            { status: forbidden ? 403 : 404 }
          );
        }
      } else if (leadId) {
        const { lead, forbidden } = await findAccessibleLead(leadId, user);
        if (forbidden || !lead) {
          return NextResponse.json(
            { success: false, error: forbidden ? "Insufficient permissions" : "Lead tidak ditemukan" },
            { status: forbidden ? 403 : 404 }
          );
        }
      }
      const rows = await query(
        `SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_JOINS}
         WHERE a.deleted_at IS NULL
           AND ${dealId ? "a.deal_id = $1" : "a.lead_id = $1"}
         ORDER BY COALESCE(a.due_at, a.created_at) DESC
         LIMIT ${MAX_AGENDA_ROWS}`,
        [dealId ?? leadId]
      );
      return successResponse(rows);
    }

    // ── Agenda "Follow-up Hari Ini": jatuh tempo hari ini + terlambat ──
    const scope = await getApiUserScope();
    const scopeError = requireCompanyScope(user, scope);
    if (scopeError) return scopeError;

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
    // Role sales hanya melihat agenda miliknya ATAU tanpa penanggung jawab
    if (user.role === "sales") {
      add("(a.owner_user_id = ? OR a.owner_user_id IS NULL)", user.id);
    }

    if (view === "today") {
      // Belum selesai & jatuh tempo s/d akhir hari ini (termasuk terlambat)
      conditions.push("a.done_at IS NULL");
      conditions.push("a.due_at IS NOT NULL");
      conditions.push("a.due_at < (CURRENT_DATE + 1)::timestamptz");
    }

    const rows = await query(
      `SELECT ${ACTIVITY_COLUMNS} ${ACTIVITY_JOINS}
       WHERE ${conditions.join(" AND ")}
       ORDER BY a.due_at ASC NULLS LAST, a.created_at DESC
       LIMIT ${MAX_AGENDA_ROWS}`,
      params
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list activities error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat aktivitas" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const parsed = createActivitySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // Aktivitas mewarisi venue dari induknya (deal diprioritaskan)
    let companyId: string;
    let branchId: string;
    if (body.deal_id) {
      const { deal, forbidden } = await findAccessibleDeal(body.deal_id, user);
      if (forbidden || !deal) {
        return NextResponse.json(
          { success: false, error: forbidden ? "Insufficient permissions" : "Deal tidak ditemukan" },
          { status: forbidden ? 403 : 404 }
        );
      }
      companyId = deal.company_id;
      branchId = deal.branch_id;
    } else {
      const { lead, forbidden } = await findAccessibleLead(
        body.lead_id as string,
        user
      );
      if (forbidden || !lead) {
        return NextResponse.json(
          { success: false, error: forbidden ? "Insufficient permissions" : "Lead tidak ditemukan" },
          { status: forbidden ? 403 : 404 }
        );
      }
      companyId = lead.company_id;
      branchId = lead.branch_id;
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

    const rows = await query(
      `INSERT INTO crm.crm_sales_activities
         (company_id, branch_id, lead_id, deal_id, activity_type, notes,
          due_at, done_at, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, activity_type, due_at, done_at`,
      [
        companyId,
        branchId,
        body.lead_id ?? null,
        body.deal_id ?? null,
        body.activity_type,
        body.notes || null,
        body.due_at ?? null,
        body.is_done ? new Date().toISOString() : null,
        body.owner_user_id || (user.role === "sales" ? user.id : null),
        user.id,
      ]
    );

    return createdResponse(rows[0], "Aktivitas dicatat");
  } catch (err) {
    console.error("[sales-funnel] create activity error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencatat aktivitas" },
      { status: 500 }
    );
  }
}
