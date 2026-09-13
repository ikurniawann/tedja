import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { emitCrmEvent } from "@/lib/crm/events";
import { validateCustomPayload, loadExistingCustom } from "@/lib/crm/custom-fields-server";
import { queryOne, withTransaction } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  DEAL_EVENT_TYPES,
  isValidCalendarDate,
  requireSalesFunnelRole,
  validateAssignableOwner,
} from "@/lib/sales-funnel/server";

const updateDealSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  event_type: z.enum(DEAL_EVENT_TYPES).optional(),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .or(z.literal("")),
  is_event_date_fixed: z.boolean().optional(),
  pax_estimate: z.number().int().min(1).max(100000).nullable().optional(),
  value_estimate: z.number().min(0).max(99_999_999_999).nullable().optional(),
  value_final: z.number().min(0).max(99_999_999_999).nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().optional(),
  lost_reason_id: z.string().uuid().nullable().optional(),
  // EPIC-050 Fase 3
  forecast_category: z.enum(["pipeline", "best_case", "commit"]).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

type StageRow = {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
  is_active: boolean;
  pipeline_id: string | null;
  probability: number;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { deal, forbidden } = await findAccessibleDeal(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!deal) {
      return NextResponse.json(
        { success: false, error: "Deal tidak ditemukan" },
        { status: 404 }
      );
    }

    const parsed = updateDealSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = { ...parsed.data };
    if (body.event_date === "") body.event_date = null;
    if (body.event_date && !isValidCalendarDate(body.event_date)) {
      return NextResponse.json(
        { success: false, error: "Tanggal acara tidak valid" },
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
      const ownerError = await validateAssignableOwner(
        body.owner_user_id,
        deal.company_id
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
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    // ── Aturan pindah tahap (acceptance criteria EPIC-022) ──
    const isStageMove = body.stage_id !== undefined && body.stage_id !== deal.stage_id;
    if (isStageMove) {
      const stage = await queryOne<StageRow>(
        `SELECT id, name, is_won, is_lost, is_active, pipeline_id, probability
         FROM crm.crm_sales_stages WHERE id = $1`,
        [body.stage_id]
      );
      if (!stage || !stage.is_active) {
        return NextResponse.json(
          { success: false, error: "Tahap tujuan tidak valid" },
          { status: 400 }
        );
      }
      // EPIC-050 Fase 3: tahap harus dalam pipeline deal (pindah pipeline = set pipeline_id ikut)
      const currentPipeline = await queryOne<{ pipeline_id: string | null }>(
        `SELECT pipeline_id FROM crm.crm_sales_deals WHERE id = $1`,
        [id]
      );
      if (stage.pipeline_id && currentPipeline?.pipeline_id && stage.pipeline_id !== currentPipeline.pipeline_id) {
        set("pipeline_id", stage.pipeline_id);
      }
      // kategori forecast mengikuti probability tahap (override manual hanya utk tahap terbuka)
      if (body.forecast_category === undefined) {
        set(
          "forecast_category",
          stage.is_won ? "closed_won" : stage.is_lost ? "closed_lost" : stage.probability >= 75 ? "commit" : stage.probability >= 50 ? "best_case" : "pipeline"
        );
      }

      if (stage.is_won) {
        const finalValue =
          body.value_final !== undefined ? body.value_final : deal.value_final;
        const eventDate =
          body.event_date !== undefined ? body.event_date : deal.event_date;
        if (finalValue === null || finalValue === undefined) {
          return NextResponse.json(
            { success: false, error: "Deal Menang wajib diisi nilai final" },
            { status: 400 }
          );
        }
        if (!eventDate) {
          return NextResponse.json(
            { success: false, error: "Deal Menang wajib punya tanggal acara fix" },
            { status: 400 }
          );
        }
        // Menang = booking terkonfirmasi: tanggal otomatis fix, alasan kalah dibuang
        body.is_event_date_fixed = true;
        body.lost_reason_id = null;
        set("closed_at", new Date().toISOString());
      } else if (stage.is_lost) {
        if (!body.lost_reason_id) {
          return NextResponse.json(
            { success: false, error: "Deal Kalah wajib pilih alasan kalah" },
            { status: 400 }
          );
        }
        set("closed_at", new Date().toISOString());
      } else {
        // Kembali ke tahap berjalan → status tutup & alasan kalah direset
        body.lost_reason_id = null;
        set("closed_at", null);
      }
      set("entered_stage_at", new Date().toISOString());
    }

    if (body.custom !== undefined) {
      const existingCustom = await loadExistingCustom("crm.crm_sales_deals", id);
      const customCheck = await validateCustomPayload("deal", deal.company_id, body.custom, existingCustom);
      if (customCheck.error) return customCheck.error;
      values.push(JSON.stringify(customCheck.values));
      sets.push(`custom = $${values.length}::jsonb`);
      delete body.custom;
    }
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      set(key, value);
    }
    if (values.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }

    values.push(id);
    // Satu transaksi: update deal + riwayat tahap — pindah tahap tanpa
    // baris riwayat membuat funnel undercount permanen (temuan gate Fase E)
    const row = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE crm.crm_sales_deals SET ${sets.join(", ")}
         WHERE id = $${values.length}
         RETURNING id, title, stage_id, closed_at`,
        values
      );
      if (isStageMove) {
        await client.query(
          `INSERT INTO crm.crm_sales_deal_stage_history
             (deal_id, stage_id, created_by)
           VALUES ($1, $2, $3)`,
          [id, body.stage_id, user.id]
        );
      }
      return updated.rows[0] ?? null;
    });

    // EPIC-050 Fase 2: event bus
    if (isStageMove) {
      const toStage = await queryOne<{ code: string; name: string; is_won: boolean; is_lost: boolean }>(
        `SELECT code, name, is_won, is_lost FROM crm.crm_sales_stages WHERE id = $1`,
        [body.stage_id]
      );
      await emitCrmEvent({
        event_type: "deal.stage_changed",
        subject_type: "deal",
        subject_id: id,
        company_id: deal.company_id,
        branch_id: deal.branch_id,
        actor_user_id: user.id,
        payload: { from_stage_id: deal.stage_id, to_stage_id: body.stage_id, to_stage: toStage?.code, to_stage_name: toStage?.name, is_won: toStage?.is_won, is_lost: toStage?.is_lost },
        changes: { stage_id: { from: deal.stage_id, to: body.stage_id }, stage_code: { from: undefined, to: toStage?.code } },
      });
    } else {
      await emitCrmEvent({
        event_type: "deal.updated",
        subject_type: "deal",
        subject_id: id,
        company_id: deal.company_id,
        branch_id: deal.branch_id,
        actor_user_id: user.id,
        payload: { changed_fields: Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined) },
      });
    }
    return successResponse(row, "Deal diperbarui");
  } catch (err) {
    console.error("[sales-funnel] update deal error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui deal" },
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
    const { deal, forbidden } = await findAccessibleDeal(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!deal) {
      return NextResponse.json(
        { success: false, error: "Deal tidak ditemukan" },
        { status: 404 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_deals SET deleted_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete deal error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus deal" },
      { status: 500 }
    );
  }
}
