import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { findAccessibleAccount, findAccessibleContact } from "@/lib/sales-funnel/access";
import { updateContactSchema } from "@/lib/sales-funnel/accounts";
import {
  isValidNormalizedPhone,
  normalizePhone,
  requireSalesFunnelRole,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  try {
    const { id } = await params;
    const { contact: access, forbidden } = await findAccessibleContact(id, user);
    if (forbidden) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }
    if (!access) {
      return NextResponse.json({ success: false, error: "Contact tidak ditemukan" }, { status: 404 });
    }
    const contact = await queryOne(
      `SELECT c.id, c.company_id, c.branch_id, c.account_id, c.name, c.title, c.phone,
              c.email, c.is_primary, c.customer_id, c.notes, c.owner_user_id, c.custom,
              c.created_at, c.updated_at,
              a.name AS account_name, a.account_type, u.full_name AS owner_name
       FROM crm.crm_contacts c
       LEFT JOIN crm.crm_accounts a ON a.id = c.account_id
       LEFT JOIN configuration.users u ON u.id = c.owner_user_id
       WHERE c.id = $1`,
      [id]
    );
    const leads = await query(
      `SELECT l.id, l.org_name, l.source, l.temperature, l.status, l.created_at
       FROM crm.crm_sales_leads l WHERE l.contact_id = $1 AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC LIMIT 50`,
      [id]
    );
    let customer: Record<string, unknown> | null = null;
    const customerId = (contact as { customer_id: string | null } | null)?.customer_id;
    if (customerId) {
      customer = await queryOne(
        `SELECT id, name, phone, membership_tier, total_xp, ark_coin_balance,
                total_spent, visit_count, last_visit, is_active
         FROM pos.pos_customers WHERE id = $1`,
        [customerId]
      );
    }
    return successResponse({ contact, leads, customer });
  } catch (err) {
    console.error("[sales-funnel] contact detail error:", err);
    return NextResponse.json({ success: false, error: "Gagal memuat contact" }, { status: 500 });
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
    const { contact, forbidden } = await findAccessibleContact(id, user);
    if (forbidden) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }
    if (!contact) {
      return NextResponse.json({ success: false, error: "Contact tidak ditemukan" }, { status: 404 });
    }
    const parsed = updateContactSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    if (body.account_id) {
      const { account, forbidden: accForbidden } = await findAccessibleAccount(body.account_id, user);
      if (accForbidden || !account) {
        return NextResponse.json(
          { success: false, error: accForbidden ? "Insufficient permissions" : "Account tidak ditemukan" },
          { status: accForbidden ? 403 : 404 }
        );
      }
      if (account.company_id !== contact.company_id) {
        return NextResponse.json({ success: false, error: "Account berada di venue lain" }, { status: 400 });
      }
    }
    if (body.owner_user_id !== undefined) {
      if (user.role === "sales" && body.owner_user_id && body.owner_user_id !== user.id) {
        return NextResponse.json(
          { success: false, error: "Role sales hanya boleh menjadi penanggung jawab sendiri" },
          { status: 403 }
        );
      }
      if (body.owner_user_id) {
        const ownerError = await validateAssignableOwner(body.owner_user_id, contact.company_id);
        if (ownerError) return NextResponse.json({ success: false, error: ownerError }, { status: 400 });
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
        const phone = normalizePhone(String(raw));
        if (!isValidNormalizedPhone(phone)) {
          return NextResponse.json({ success: false, error: "Nomor WA tidak valid" }, { status: 400 });
        }
        const duplicate = await queryOne<{ id: string }>(
          `SELECT id FROM crm.crm_contacts
           WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL AND id <> $3`,
          [contact.company_id, phone, id]
        );
        if (duplicate) {
          return NextResponse.json({ success: false, error: "Nomor ini sudah dipakai contact lain" }, { status: 409 });
        }
        push("phone", phone);
        continue;
      }
      if (key === "custom") {
        push("custom", JSON.stringify(raw ?? {}), "::jsonb");
        continue;
      }
      push(key, raw === "" ? null : raw);
    }
    if (values.length === 0) {
      return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
    }
    values.push(id);
    const row = await queryOne<{ id: string; account_id: string | null; is_primary: boolean }>(
      `UPDATE crm.crm_contacts SET ${sets.join(", ")} WHERE id = $${values.length}
       RETURNING id, account_id, name, phone, is_primary, updated_at`,
      values
    );
    // Hanya satu contact utama per account
    if (row?.is_primary && row.account_id) {
      await query(
        `UPDATE crm.crm_contacts SET is_primary = false, updated_at = now()
         WHERE account_id = $1 AND id <> $2 AND deleted_at IS NULL AND is_primary`,
        [row.account_id, id]
      );
    }
    return successResponse(row, "Contact diperbarui");
  } catch (err) {
    console.error("[sales-funnel] update contact error:", err);
    return NextResponse.json({ success: false, error: "Gagal memperbarui contact" }, { status: 500 });
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
    const { contact, forbidden } = await findAccessibleContact(id, user);
    if (forbidden) {
      return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
    }
    if (!contact) {
      return NextResponse.json({ success: false, error: "Contact tidak ditemukan" }, { status: 404 });
    }
    await query(
      `UPDATE crm.crm_sales_leads SET contact_id = NULL, updated_at = now() WHERE contact_id = $1`,
      [id]
    );
    await query(
      `UPDATE crm.crm_contacts SET deleted_at = now(), updated_at = now() WHERE id = $1`,
      [id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete contact error:", err);
    return NextResponse.json({ success: false, error: "Gagal menghapus contact" }, { status: 500 });
  }
}
