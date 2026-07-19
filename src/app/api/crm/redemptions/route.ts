import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import {
  apiErrorResponse,
  validationErrorResponse,
  requireCrmOperator,
  requireCrmReader,
} from "@/lib/crm/server";
import { createRedemption, updateRedemptionStatus } from "@/lib/crm/rewards-server";

/**
 * EPIC-011 Fase F — antrean & riwayat redeem reward.
 *
 * XP TIDAK dipotong: `min_xp` reward hanya syarat kelayakan. Yang membatasi
 * adalah kuota per member (max_redemptions_per_member × quota_period) dan stok.
 */

const claimSchema = z.object({
  customer_id: z.string().uuid(),
  reward_id: z.string().uuid(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "fulfill", "cancel"]),
  notes: z.string().trim().max(500).nullable().optional(),
});

function isMissingRedemptionSchema(error: unknown) {
  const candidate = error as { code?: string } | null;
  return candidate?.code === "42P01" || candidate?.code === "42703";
}

export async function GET(request: NextRequest) {
  // Respons memuat PII member (nama/telepon/XP) — batasi ke peran ber-kebutuhan.
  const guard = await requireCrmReader();
  if (guard.error) return guard.error;

  try {
    const pool = getPool();
    const params = request.nextUrl.searchParams;
    const status = params.get("status");
    const customerId = params.get("customer_id");
    const memberId = params.get("member_id");
    const rawLimit = params.get("limit");
    const parsedLimit = Number(rawLimit);
    const limit =
      rawLimit !== null && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 200)
        : 100;

    const values: unknown[] = [];
    const filters: string[] = [];

    if (status && status !== "all") {
      values.push(status);
      filters.push(`r.status = $${values.length}`);
    }
    if (customerId) {
      values.push(customerId);
      filters.push(`r.customer_id = $${values.length}`);
    }
    if (memberId) {
      values.push(memberId);
      filters.push(`r.member_id = $${values.length}`);
    }
    values.push(limit);

    const { rows } = await pool.query(
      `SELECT r.id, r.redemption_number, r.status, r.channel,
              r.min_xp_at_redeem::int AS min_xp_at_redeem,
              r.total_xp_at_redeem::int AS total_xp_at_redeem,
              r.requested_at, r.approved_at, r.fulfilled_at, r.cancelled_at, r.notes,
              r.customer_id, r.voucher_code,
              c.name AS customer_name, c.phone AS customer_phone,
              c.total_xp::float AS customer_total_xp,
              w.id AS reward_id, w.code AS reward_code, w.name AS reward_name,
              w.reward_type,
              json_build_object(
                'id', w.id, 'code', w.code, 'name', w.name,
                'reward_type', w.reward_type, 'min_xp', w.min_xp
              ) AS reward
         FROM crm.crm_redemptions r
         JOIN crm.crm_rewards w ON w.id = r.reward_id
         LEFT JOIN pos.pos_customers c ON c.id = r.customer_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY r.requested_at DESC
        LIMIT $${values.length}`,
      values
    );

    return NextResponse.json({ success: true, data: rows, meta: { schemaReady: true } });
  } catch (error) {
    if (isMissingRedemptionSchema(error)) {
      return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
    }
    console.error("Error fetching CRM redemptions:", error);
    return apiErrorResponse(error);
  }
}

/** Kasir/admin mengklaim reward atas nama member di venue → langsung fulfilled. */
export async function POST(request: NextRequest) {
  const guard = await requireCrmOperator();
  if (guard.error) return guard.error;

  try {
    const payload = claimSchema.parse(await request.json());
    const result = await createRedemption(getPool(), {
      customerId: payload.customer_id,
      rewardId: payload.reward_id,
      channel: "admin",
      actorUserId: guard.user.id,
      notes: payload.notes ?? null,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, data: result.redemption });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    if (isMissingRedemptionSchema(error)) {
      return NextResponse.json(
        { success: false, error: "Migrasi CRM Fase F belum diterapkan" },
        { status: 409 }
      );
    }

    console.error("Error creating CRM redemption:", error);
    return apiErrorResponse(error);
  }
}

/** Approve / fulfill / cancel permintaan redeem yang datang dari portal member. */
export async function PATCH(request: NextRequest) {
  const guard = await requireCrmOperator();
  if (guard.error) return guard.error;

  try {
    const payload = updateSchema.parse(await request.json());
    const result = await updateRedemptionStatus(getPool(), {
      redemptionId: payload.id,
      action: payload.action,
      actorUserId: guard.user.id,
      notes: payload.notes ?? null,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, data: result.redemption });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    console.error("Error updating CRM redemption:", error);
    return apiErrorResponse(error);
  }
}
