import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { findAccessibleLead } from "@/lib/sales-funnel/access";
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
    if (body.pic_phone !== undefined) {
      body.pic_phone = normalizePhone(body.pic_phone);
      if (!isValidNormalizedPhone(body.pic_phone)) {
        return NextResponse.json(
          { success: false, error: "No. WA PIC tidak valid" },
          { status: 400 }
        );
      }
      const duplicate = await queryOne<{ id: string }>(
        `SELECT id FROM crm.crm_sales_leads
         WHERE company_id = $1 AND pic_phone = $2 AND id <> $3 AND deleted_at IS NULL`,
        [lead.company_id, body.pic_phone, id]
      );
      if (duplicate) {
        return NextResponse.json(
          { success: false, error: "Lead lain dengan no. WA PIC ini sudah ada" },
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
    return successResponse(row, "Lead diperbarui");
  } catch (err) {
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
