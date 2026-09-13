import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { findAccessibleLead } from "@/lib/sales-funnel/access";
import { syncLeadAccountContact } from "@/lib/sales-funnel/account-sync";
import { emitCrmEvent } from "@/lib/crm/events";
import {
  LEAD_ORG_TYPES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  isValidNormalizedPhone,
  normalizePhone,
  requireSalesFunnelRole,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

const updateLeadSchema = z.object({
  org_name: z.string().trim().min(1).max(200).optional(),
  org_type: z.enum(LEAD_ORG_TYPES).optional(),
  pic_name: z.string().trim().min(1).max(150).optional(),
  pic_title: z.string().trim().max(100).nullable().optional(),
  pic_phone: z.string().trim().min(8).max(30).optional(),
  pic_email: z.string().trim().email().max(150).nullable().optional().or(z.literal("")),
  city: z.string().trim().max(100).nullable().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  temperature: z.enum(LEAD_TEMPERATURES).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
});

/**
 * Detail 360° instansi (EPIC-022 Fase D): lead + semua deal/acara +
 * aktivitas gabungan (lead & deal-dealnya) + ringkasan member loyalty PIC
 * bila tertaut pos_customers (member global by design per EPIC-011).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { lead: access, forbidden } = await findAccessibleLead(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!access) {
      return NextResponse.json(
        { success: false, error: "Lead tidak ditemukan" },
        { status: 404 }
      );
    }

    const lead = await queryOne(
      `SELECT l.id, l.company_id, l.branch_id, l.org_name, l.org_type,
              l.pic_name, l.pic_title, l.pic_phone, l.pic_email, l.city,
              l.source, l.temperature, l.status, l.notes, l.owner_user_id,
              l.customer_id, l.account_id, l.contact_id, l.score, l.score_breakdown, l.score_updated_at, l.created_at, l.updated_at,
              u.full_name AS owner_name, b.name AS branch_name, acc.name AS account_name
       FROM crm.crm_sales_leads l
       LEFT JOIN configuration.users u ON u.id = l.owner_user_id
       LEFT JOIN configuration.branches b ON b.id = l.branch_id
       LEFT JOIN crm.crm_accounts acc ON acc.id = l.account_id
       WHERE l.id = $1`,
      [id]
    );

    const deals = await query(
      `SELECT d.id, d.title, d.event_type, d.event_date, d.is_event_date_fixed,
              d.pax_estimate, d.value_estimate, d.value_final, d.closed_at,
              d.entered_stage_at, d.created_at,
              s.name AS stage_name, s.code AS stage_code, s.is_won, s.is_lost,
              lr.name AS lost_reason_name
       FROM crm.crm_sales_deals d
       JOIN crm.crm_sales_stages s ON s.id = d.stage_id
       LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
       WHERE d.lead_id = $1 AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC
       -- pagar wajar; statistik 360° ikut terpotong bila riwayat > 100 deal
       LIMIT 100`,
      [id]
    );

    // Timeline gabungan: aktivitas lead + aktivitas semua deal-nya
    const activities = await query(
      `SELECT a.id, a.deal_id, a.activity_type, a.notes, a.due_at, a.done_at,
              a.created_at, u.full_name AS owner_name, d.title AS deal_title
       FROM crm.crm_sales_activities a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       LEFT JOIN crm.crm_sales_deals d ON d.id = a.deal_id
       WHERE a.deleted_at IS NULL
         AND (a.lead_id = $1
              OR a.deal_id IN (SELECT id FROM crm.crm_sales_deals
                               WHERE lead_id = $1 AND deleted_at IS NULL))
       ORDER BY COALESCE(a.due_at, a.created_at) DESC
       LIMIT 30`,
      [id]
    );

    // Ringkasan member loyalty (pos_customers global by design EPIC-011)
    let customer: Record<string, unknown> | null = null;
    let recentOrders: Record<string, unknown>[] = [];
    const customerId = (lead as { customer_id: string | null } | null)
      ?.customer_id;
    if (customerId) {
      customer = await queryOne(
        `SELECT id, name, phone, membership_tier, total_xp, ark_coin_balance,
                total_spent, visit_count, last_visit, is_active
         FROM pos.pos_customers WHERE id = $1`,
        [customerId]
      );
      if (customer) {
        recentOrders = await query(
          `SELECT id, total_amount, status, payment_status, created_at
           FROM pos.pos_orders
           WHERE customer_id = $1
           ORDER BY created_at DESC
           LIMIT 5`,
          [customerId]
        );
      }
    }

    return successResponse({
      lead,
      deals,
      activities,
      customer,
      recent_orders: recentOrders,
    });
  } catch (err) {
    console.error("[sales-funnel] lead detail error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat detail instansi" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { lead, forbidden } = await findAccessibleLead(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!lead) {
      return NextResponse.json(
        { success: false, error: "Lead tidak ditemukan" },
        { status: 404 }
      );
    }

    const parsed = updateLeadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const body = { ...parsed.data };
    // EPIC-050 Fase 2: snapshot sebelum update utk kondisi workflow changed/changed_to
    const before = (await queryOne<Record<string, unknown>>(
      `SELECT org_name, org_type, pic_name, pic_phone, pic_email, city, source, temperature,
              status, notes, owner_user_id FROM crm.crm_sales_leads WHERE id = $1`,
      [id]
    )) ?? {};
    if (body.pic_phone !== undefined) {
      body.pic_phone = normalizePhone(body.pic_phone);
      if (!isValidNormalizedPhone(body.pic_phone)) {
        return NextResponse.json(
          { success: false, error: "No. WA PIC tidak valid" },
          { status: 400 }
        );
      }
    }
    // Duplikat = kombinasi instansi + no. WA sama (satu PIC boleh banyak
    // leads) — cek saat salah satunya berubah, pakai nilai efektif
    if (body.pic_phone !== undefined || body.org_name !== undefined) {
      const current = await queryOne<{ org_name: string; pic_phone: string }>(
        `SELECT org_name, pic_phone FROM crm.crm_sales_leads WHERE id = $1`,
        [id]
      );
      const effectivePhone = body.pic_phone ?? current?.pic_phone ?? "";
      const effectiveOrg = body.org_name ?? current?.org_name ?? "";
      const duplicate = await queryOne<{ id: string }>(
        `SELECT id FROM crm.crm_sales_leads
         WHERE company_id = $1 AND pic_phone = $2
           AND lower(org_name) = lower($3) AND id <> $4 AND deleted_at IS NULL`,
        [lead.company_id, effectivePhone, effectiveOrg, id]
      );
      if (duplicate) {
        return NextResponse.json(
          { success: false, error: "Lead instansi ini dengan PIC yang sama sudah ada" },
          { status: 409 }
        );
      }
    }
    if (body.pic_email === "") body.pic_email = null;
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
      const ownerError = await validateAssignableOwner(
        body.owner_user_id,
        lead.company_id
      );
      if (ownerError) {
        return NextResponse.json(
          { success: false, error: ownerError },
          { status: 400 }
        );
      }
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    if (values.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }

    values.push(id);
    const row = await queryOne(
      `UPDATE crm.crm_sales_leads SET ${sets.join(", ")}
       WHERE id = $${values.length}
       RETURNING id, org_name, pic_name, pic_phone, status`,
      values
    );
    // EPIC-050: nama instansi / PIC berubah → sinkronkan Account/Contact
    await syncLeadAccountContact(id).catch((e) =>
      console.error("[sales-funnel] sync account/contact gagal:", e)
    );
    // EPIC-050 Fase 2: event bus (perubahan field utk kondisi changed/changed_to)
    {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        if (key in before && before[key] !== value) changes[key] = { from: before[key], to: value };
        else if (!(key in before)) changes[key] = { from: undefined, to: value };
      }
      await emitCrmEvent({
        event_type: "lead.updated",
        subject_type: "lead",
        subject_id: id,
        company_id: lead.company_id,
        branch_id: lead.branch_id,
        actor_user_id: user.id,
        payload: { changed_fields: Object.keys(changes) },
        changes,
      });
    }
    return successResponse(row, "Lead diperbarui");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Lead instansi ini dengan PIC yang sama sudah ada" },
        { status: 409 }
      );
    }
    console.error("[sales-funnel] update lead error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui lead" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { lead, forbidden } = await findAccessibleLead(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!lead) {
      return NextResponse.json(
        { success: false, error: "Lead tidak ditemukan" },
        { status: 404 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_leads SET deleted_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete lead error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus lead" },
      { status: 500 }
    );
  }
}
