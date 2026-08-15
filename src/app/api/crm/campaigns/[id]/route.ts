import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue, requireCrmCampaign } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { query, queryOne, withTransaction } from "@/lib/db";
import { normalizeSegment } from "@/lib/crm/campaigns";
import { buildCampaignRecipients } from "@/lib/crm/campaigns-server";

// EPIC-033 — aksi satu kampanye: edit (draft), start (build antrean →
// sending), pause/resume, cancel. Build antrean idempoten; PENGIRIMAN
// tetap di tangan watcher + master switch (default MATI).

const patchSchema = z.object({
  action: z.enum(["start", "pause", "resume", "cancel"]).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  message_template: z.string().trim().min(10).max(2000).optional(),
  segment: z.unknown().optional(),
  daily_cap: z.number().int().positive().max(2000).nullable().optional(),
});

interface CampaignRow {
  id: string;
  company_id: string;
  branch_id: string;
  status: string;
  segment: unknown;
  promo_campaign_id: string | null;
  promo_mode: "public" | "batch" | null;
  voucher_prefix: string | null;
  recipients_built: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireCrmCampaign();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const venue = await getCrmDefaultVenue(createPgClient());
    const campaign = await queryOne<CampaignRow>(
      `SELECT id, company_id, branch_id, status, segment, promo_campaign_id,
              promo_mode, voucher_prefix, recipients_built
       FROM crm.crm_campaigns WHERE id = $1 AND branch_id = $2`,
      [id, venue.branchId]
    );
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: "Kampanye tidak ditemukan" },
        { status: 404 }
      );
    }

    if (body.action === "start") {
      if (!["draft", "paused"].includes(campaign.status)) {
        return NextResponse.json(
          { success: false, error: `Kampanye berstatus ${campaign.status} — tidak bisa dimulai` },
          { status: 409 }
        );
      }
      // Build antrean sekali (idempoten) di dalam transaksi, lalu sending
      const inserted = await withTransaction(async (client) => {
        const result = await buildCampaignRecipients(client, {
          id: campaign.id,
          companyId: campaign.company_id,
          branchId: campaign.branch_id,
          segment: normalizeSegment(campaign.segment),
          promoCampaignId: campaign.promo_campaign_id,
          promoMode: campaign.promo_mode,
          voucherPrefix: campaign.voucher_prefix,
        });
        await client.query(
          `UPDATE crm.crm_campaigns
           SET status = 'sending', recipients_built = true, updated_at = now()
           WHERE id = $1`,
          [campaign.id]
        );
        return result.inserted;
      });
      return successResponse(
        { id, inserted },
        `Kampanye dimulai — ${inserted} penerima baru masuk antrean (pengiriman mengikuti master switch & jam kirim)`
      );
    }

    if (body.action === "pause" || body.action === "cancel") {
      const target = body.action === "pause" ? "paused" : "cancelled";
      await query(
        `UPDATE crm.crm_campaigns SET status = $2, updated_at = now()
         WHERE id = $1 AND status IN ('sending', 'paused', 'draft')`,
        [id, target]
      );
      return successResponse({ id }, body.action === "pause" ? "Kampanye dijeda" : "Kampanye dibatalkan");
    }
    if (body.action === "resume") {
      await query(
        `UPDATE crm.crm_campaigns SET status = 'sending', updated_at = now()
         WHERE id = $1 AND status = 'paused'`,
        [id]
      );
      return successResponse({ id }, "Kampanye dilanjutkan");
    }

    // Edit field — hanya draft (antrean belum dibangun dari segmen lama)
    if (campaign.status !== "draft") {
      return NextResponse.json(
        { success: false, error: "Hanya kampanye draft yang bisa diedit — jeda/batalkan dulu" },
        { status: 409 }
      );
    }
    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.message_template !== undefined) {
      add("message_template", body.message_template);
    }
    if (body.segment !== undefined) {
      add("segment", JSON.stringify(normalizeSegment(body.segment)));
    }
    if (body.daily_cap !== undefined) add("daily_cap", body.daily_cap);
    values.push(id);
    await query(
      `UPDATE crm.crm_campaigns SET ${sets.join(", ")} WHERE id = $${values.length}`,
      values
    );
    return successResponse({ id }, "Kampanye diperbarui");
  } catch (err) {
    console.error("[crm-campaign] patch error:", err);
    return NextResponse.json(
      { success: false, error: (err as Error).message || "Gagal memperbarui kampanye" },
      { status: 500 }
    );
  }
}
