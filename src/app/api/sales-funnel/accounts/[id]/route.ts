import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { findAccessibleAccount } from "@/lib/sales-funnel/access";
import { updateAccountSchema } from "@/lib/sales-funnel/accounts";
import { validateCustomPayload, loadExistingCustom } from "@/lib/crm/custom-fields-server";
import {
  isValidNormalizedPhone,
  normalizePhone,
  requireSalesFunnelRole,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

/** Account 360° (EPIC-050 T-1.3): profil + contacts + leads + deals + quotation/invoice ringkas + tasks. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  try {
    const { id } = await params;
    const { account: access, forbidden } = await findAccessibleAccount(id, user);
    if (forbidden) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }
    if (!access) {
      return NextResponse.json({ success: false, error: "Account tidak ditemukan" }, { status: 404 });
    }
    const account = await queryOne(
      `SELECT a.id, a.company_id, a.branch_id, a.name, a.account_type, a.industry,
              a.address, a.city, a.phone, a.email, a.website, a.npwp, a.notes,
              a.owner_user_id, a.custom, a.created_at, a.updated_at,
              u.full_name AS owner_name, b.name AS branch_name
       FROM crm.crm_accounts a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       LEFT JOIN configuration.branches b ON b.id = a.branch_id
       WHERE a.id = $1`,
      [id]
    );
    const contacts = await query(
      `SELECT c.id, c.name, c.title, c.phone, c.email, c.is_primary, c.customer_id,
              c.owner_user_id, c.created_at, u.full_name AS owner_name
       FROM crm.crm_contacts c
       LEFT JOIN configuration.users u ON u.id = c.owner_user_id
       WHERE c.account_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.is_primary DESC, c.created_at ASC
       LIMIT 200`,
      [id]
    );
    const leads = await query(
      `SELECT l.id, l.org_name, l.pic_name, l.pic_phone, l.source, l.temperature,
              l.status, l.owner_user_id, l.created_at, u.full_name AS owner_name
       FROM crm.crm_sales_leads l
       LEFT JOIN configuration.users u ON u.id = l.owner_user_id
       WHERE l.account_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC
       LIMIT 100`,
      [id]
    );
    const deals = await query(
      `SELECT d.id, d.lead_id, d.title, d.event_type, d.event_date, d.pax_estimate,
              d.value_estimate, d.value_final, d.closed_at, d.entered_stage_at, d.created_at,
              s.name AS stage_name, s.code AS stage_code, s.is_won, s.is_lost,
              lr.name AS lost_reason_name
       FROM crm.crm_sales_deals d
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       JOIN crm.crm_sales_stages s ON s.id = d.stage_id
       LEFT JOIN crm.crm_sales_lost_reasons lr ON lr.id = d.lost_reason_id
       WHERE l.account_id = $1 AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC
       LIMIT 100`,
      [id]
    );
    const quotations = await query(
      `SELECT q.id, q.deal_id, q.quote_number, q.status, q.total, q.valid_until, q.created_at
       FROM crm.crm_sales_quotations q
       JOIN crm.crm_sales_deals d ON d.id = q.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       WHERE l.account_id = $1 AND q.deleted_at IS NULL
       ORDER BY q.created_at DESC
       LIMIT 50`,
      [id]
    );
    const invoices = await query(
      `SELECT i.id, i.deal_id, i.invoice_number, i.label, i.amount, i.due_date, i.status, i.created_at
       FROM crm.crm_sales_invoices i
       JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       WHERE l.account_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 50`,
      [id]
    );
    const tasks = await query(
      `SELECT a.id, a.activity_type, a.title, a.notes, a.due_at, a.done_at, a.status,
              a.priority, a.subject_type, a.subject_id, a.created_at, u.full_name AS owner_name
       FROM crm.crm_sales_activities a
       LEFT JOIN configuration.users u ON u.id = a.owner_user_id
       WHERE a.deleted_at IS NULL
         AND ((a.subject_type = 'account' AND a.subject_id = $1)
              OR a.lead_id IN (SELECT id FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL)
              OR a.deal_id IN (SELECT d.id FROM crm.crm_sales_deals d JOIN crm.crm_sales_leads l ON l.id = d.lead_id
                               WHERE l.account_id = $1 AND d.deleted_at IS NULL)
              OR (a.subject_type = 'contact' AND a.subject_id IN
                    (SELECT id FROM crm.crm_contacts WHERE account_id = $1 AND deleted_at IS NULL)))
       ORDER BY COALESCE(a.due_at, a.created_at) DESC
       LIMIT 50`,
      [id]
    );
    return successResponse({ account, contacts, leads, deals, quotations, invoices, tasks });
  } catch (err) {
    console.error("[sales-funnel] account detail error:", err);
    return NextResponse.json({ success: false, error: "Gagal memuat account" }, { status: 500 });
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
    const { account, forbidden } = await findAccessibleAccount(id, user);
    if (forbidden) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }
    if (!account) {
      return NextResponse.json({ success: false, error: "Account tidak ditemukan" }, { status: 404 });
    }
    const parsed = updateAccountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    if (body.owner_user_id !== undefined) {
      if (user.role === "sales" && body.owner_user_id && body.owner_user_id !== user.id) {
        return NextResponse.json(
          { success: false, error: "Role sales hanya boleh menjadi penanggung jawab sendiri" },
          { status: 403 }
        );
      }
      if (body.owner_user_id) {
        const ownerError = await validateAssignableOwner(body.owner_user_id, account.company_id);
        if (ownerError) return NextResponse.json({ success: false, error: ownerError }, { status: 400 });
      }
    }
    if (body.name) {
      const duplicate = await queryOne<{ id: string }>(
        `SELECT id FROM crm.crm_accounts
         WHERE company_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL AND id <> $3`,
        [account.company_id, body.name, id]
      );
      if (duplicate) {
        return NextResponse.json({ success: false, error: "Account dengan nama ini sudah ada" }, { status: 409 });
      }
    }
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const push = (column: string, value: unknown, cast = "") => {
      values.push(value);
      sets.push(`${column} = $${values.length}${cast}`);
    };
    for (const [key, raw] of Object.entries(body)) {
      if (raw === undefined) continue;
      if (key === "phone") {
        if (!raw) {
          push("phone", null);
        } else {
          const phone = normalizePhone(String(raw));
          if (!isValidNormalizedPhone(phone)) {
            return NextResponse.json({ success: false, error: "Nomor telepon tidak valid" }, { status: 400 });
          }
          push("phone", phone);
        }
        continue;
      }
      if (key === "custom") {
        const existingCustom = await loadExistingCustom("crm.crm_accounts", id);
        const customCheck = await validateCustomPayload("account", account.company_id, raw as Record<string, unknown>, existingCustom);
        if (customCheck.error) return customCheck.error;
        push("custom", JSON.stringify(customCheck.values), "::jsonb");
        continue;
      }
      push(key, raw === "" ? null : raw);
    }
    if (values.length === 0) {
      return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
    }
    values.push(id);
    const row = await queryOne(
      `UPDATE crm.crm_accounts SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING id, name, account_type, city, owner_user_id, updated_at`,
      values
    );
    return successResponse(row, "Account diperbarui");
  } catch (err) {
    console.error("[sales-funnel] update account error:", err);
    return NextResponse.json({ success: false, error: "Gagal memperbarui account" }, { status: 500 });
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
    const { account, forbidden } = await findAccessibleAccount(id, user);
    if (forbidden) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }
    if (!account) {
      return NextResponse.json({ success: false, error: "Account tidak ditemukan" }, { status: 404 });
    }
    const inUse = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM crm.crm_sales_leads WHERE account_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (Number(inUse?.n ?? 0) > 0) {
      return NextResponse.json(
        { success: false, error: "Account masih punya lead aktif — hapus/pindahkan lead-nya dulu" },
        { status: 409 }
      );
    }
    await query(
      `UPDATE crm.crm_contacts SET account_id = NULL, updated_at = now() WHERE account_id = $1`,
      [id]
    );
    await query(
      `UPDATE crm.crm_accounts SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete account error:", err);
    return NextResponse.json({ success: false, error: "Gagal menghapus account" }, { status: 500 });
  }
}
