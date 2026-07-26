import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { requireCrmCampaign } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { query } from "@/lib/db";
import {
  normalizeSegment,
  validateTemplate,
} from "@/lib/crm/campaigns";

// EPIC-033 — daftar + buat kampanye WA. Pengelola: super_admin + marketing.

interface CampaignListRow {
  id: string;
  name: string;
  message_template: string;
  segment: unknown;
  promo_campaign_id: string | null;
  promo_mode: "public" | "batch" | null;
  voucher_prefix: string | null;
  status: string;
  daily_cap: number | null;
  recipients_built: boolean;
  created_at: string;
  pending_count: string;
  sent_count: string;
  failed_count: string;
}

export async function GET() {
  const { error } = await requireCrmCampaign();
  if (error) return error;

  try {
    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi" },
        { status: 400 }
      );
    }
    const rows = await query<CampaignListRow>(
      `SELECT k.id, k.name, k.message_template, k.segment,
              k.promo_campaign_id, k.promo_mode, k.voucher_prefix, k.status,
              k.daily_cap, k.recipients_built, k.created_at,
              (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
                WHERE r.campaign_id = k.id AND r.status = 'pending') AS pending_count,
              (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
                WHERE r.campaign_id = k.id AND r.status = 'sent') AS sent_count,
              (SELECT COUNT(*) FROM crm.crm_campaign_recipients r
                WHERE r.campaign_id = k.id AND r.status = 'failed') AS failed_count
       FROM crm.crm_campaigns k
       WHERE k.branch_id = $1
       ORDER BY k.created_at DESC`,
      [venue.branchId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[crm-campaign] list error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat kampanye" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  message_template: z.string().trim().min(10).max(2000),
  segment: z.unknown(),
  promo_campaign_id: z.string().uuid().nullable().optional(),
  promo_mode: z.enum(["public", "batch"]).nullable().optional(),
  voucher_prefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,12}$/)
    .nullable()
    .optional(),
  daily_cap: z.number().int().positive().max(2000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const { error, user } = await requireCrmCampaign();
  if (error) return error;

  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const promoMode = body.promo_campaign_id ? (body.promo_mode ?? "public") : null;
    if (promoMode === "batch" && !body.voucher_prefix) {
      return NextResponse.json(
        { success: false, error: "Mode voucher batch wajib mengisi prefix kode" },
        { status: 400 }
      );
    }
    const templateCheck = validateTemplate(body.message_template, promoMode);
    if (!templateCheck.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            templateCheck.reason === "template-tanpa-kode"
              ? "Mode voucher batch wajib menyebut {kode} di template"
              : "Template memuat {kode} tapi kampanye tidak melampirkan promo",
        },
        { status: 400 }
      );
    }

    const venue = await getCrmDefaultVenue(createPgClient());
    if (!venue.companyId || !venue.branchId) {
      return NextResponse.json(
        { success: false, error: "Venue belum dikonfigurasi" },
        { status: 400 }
      );
    }
    const rows = await query<{ id: string }>(
      `INSERT INTO crm.crm_campaigns
         (company_id, branch_id, name, message_template, segment,
          promo_campaign_id, promo_mode, voucher_prefix, daily_cap, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        venue.companyId,
        venue.branchId,
        body.name,
        body.message_template,
        JSON.stringify(normalizeSegment(body.segment)),
        body.promo_campaign_id ?? null,
        promoMode,
        promoMode === "batch" ? body.voucher_prefix!.toUpperCase() : null,
        body.daily_cap ?? null,
        user.id,
      ]
    );
    return successResponse({ id: rows[0].id }, "Kampanye dibuat (draft)");
  } catch (err) {
    console.error("[crm-campaign] create error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat kampanye" },
      { status: 500 }
    );
  }
}
