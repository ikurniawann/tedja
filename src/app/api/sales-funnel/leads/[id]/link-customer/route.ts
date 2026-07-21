import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { findAccessibleLead } from "@/lib/sales-funnel/access";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const linkSchema = z
  .object({
    // Tautkan member existing…
    customer_id: z.string().uuid().optional().nullable(),
    // …atau buat member baru dari data PIC (alur "Menang → jadikan member")
    create_from_pic: z.boolean().default(false),
  })
  .refine((v) => v.customer_id || v.create_from_pic, {
    message: "Pilih member atau buat dari PIC",
  });

type LeadPicRow = {
  id: string;
  org_name: string;
  pic_name: string;
  pic_phone: string;
  pic_email: string | null;
  city: string | null;
  customer_id: string | null;
};

/**
 * Fase D: tautkan PIC lead ke member loyalty (pos_customers — global by
 * design per EPIC-011). `create_from_pic` membuat pos_customers baru dari
 * data PIC (atau memakai yang sudah ada dengan nomor sama) lalu meng-enrol
 * profil loyalty tier regular, meniru alur enrolment CRM members.
 */
export async function POST(
  request: NextRequest,
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

    const parsed = linkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const lead = await queryOne<LeadPicRow>(
      `SELECT id, org_name, pic_name, pic_phone, pic_email, city, customer_id
       FROM crm.crm_sales_leads WHERE id = $1`,
      [id]
    );
    if (!lead) {
      return NextResponse.json(
        { success: false, error: "Lead tidak ditemukan" },
        { status: 404 }
      );
    }

    let customerId = parsed.data.customer_id ?? null;

    if (customerId) {
      const customer = await queryOne<{ id: string; phone: string | null }>(
        `SELECT id, phone FROM pos.pos_customers WHERE id = $1 AND is_active = true`,
        [customerId]
      );
      if (!customer) {
        return NextResponse.json(
          { success: false, error: "Member tidak ditemukan" },
          { status: 404 }
        );
      }
      // Anti-IDOR (temuan security gate Fase D): tautan hanya untuk member
      // yang MEMANG PIC-nya — nomor WA harus sama (keduanya kanonik 62…).
      // Tanpa ini, role sales bisa menaut-lepas member sembarang untuk
      // membaca riwayat belanja mereka satu per satu.
      if (!customer.phone || customer.phone !== lead.pic_phone) {
        return NextResponse.json(
          {
            success: false,
            error:
              "No. WA member tidak sama dengan no. WA PIC — hanya member milik PIC yang bisa ditautkan",
          },
          { status: 400 }
        );
      }
    } else {
      // Buat dari PIC — nomor sudah kanonik 62… sejak create/update lead.
      // Upsert by phone (UNIQUE pos_customers_phone_key): nomor yang sudah
      // terdaftar dipakai apa adanya, race dua request tetap aman.
      const upserted = await queryOne<{ id: string }>(
        `INSERT INTO pos.pos_customers (name, phone, email, city, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (phone) DO UPDATE
           SET is_active = true, updated_at = now()
         RETURNING id`,
        [
          lead.pic_name,
          lead.pic_phone,
          lead.pic_email,
          lead.city,
          `PIC ${lead.org_name} — didaftarkan dari Sales Funneling`,
        ]
      );
      customerId = upserted?.id ?? null;

      // Enrol profil loyalty tier regular (pola POST /api/crm/members);
      // dilewati diam-diam bila skema CRM loyalty belum diterapkan.
      if (customerId) {
        try {
          await queryOne(
            `INSERT INTO crm.crm_member_profiles
               (customer_id, tier_id, lifetime_xp, loyalty_score, status,
                last_activity_at)
             SELECT $1, t.id, 0, 0, 'active', now()
             FROM crm.crm_membership_tiers t
             WHERE t.code = 'regular'
             ON CONFLICT (customer_id) DO NOTHING
             RETURNING customer_id`,
            [customerId]
          );
        } catch (enrollErr) {
          // Hanya "tabel belum ada" (42P01 — skema CRM loyalty belum
          // di-migrate) yang boleh dilewati; error lain harus terlihat.
          if ((enrollErr as { code?: string }).code !== "42P01") throw enrollErr;
          console.warn(
            "[sales-funnel] enrol loyalty dilewati (skema CRM belum siap):",
            enrollErr instanceof Error ? enrollErr.message : enrollErr
          );
        }
      }
    }

    if (!customerId) {
      return NextResponse.json(
        { success: false, error: "Gagal menyiapkan member" },
        { status: 500 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_leads
       SET customer_id = $1, updated_at = now()
       WHERE id = $2 RETURNING id`,
      [customerId, id]
    );

    return successResponse(
      { customer_id: customerId },
      "PIC tertaut ke member loyalty"
    );
  } catch (err) {
    console.error("[sales-funnel] link customer error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menautkan member" },
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
      `UPDATE crm.crm_sales_leads
       SET customer_id = NULL, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id]
    );
    return successResponse({ customer_id: null }, "Tautan member dilepas");
  } catch (err) {
    console.error("[sales-funnel] unlink customer error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal melepas tautan member" },
      { status: 500 }
    );
  }
}
