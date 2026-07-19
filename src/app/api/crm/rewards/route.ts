import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { apiErrorResponse, isMissingCrmSchema, validationErrorResponse,
  requireCrmConfigRole,
} from "@/lib/crm/server";

const rewardSchema = z.object({
  code: z.string().trim().min(1).max(80).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  reward_type: z.enum(["discount", "merchandise", "avatar", "voucher", "ark_coin", "custom"]),
  xp_cost: z.number().int().nonnegative(),
  required_tier_id: z.string().uuid().nullable().optional(),
  linked_avatar_id: z.string().uuid().nullable().optional(),
  stock_total: z.number().int().nonnegative().nullable().optional(),
  stock_redeemed: z.number().int().nonnegative().default(0),
  max_redemptions_per_member: z.number().int().positive().nullable().optional(),
  image_url: z.string().trim().url().nullable().optional(),
  reward_data: z.record(z.string(), z.unknown()).default({}),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const rewardType = request.nextUrl.searchParams.get("reward_type");
    const includeAvatarRewards = request.nextUrl.searchParams.get("include_avatar_rewards") === "true";

    let query = db
      .from("crm_rewards")
      .select("*, required_tier:crm_membership_tiers(code, name, rank)")
      .order("created_at", { ascending: false });

    if (rewardType) query = query.eq("reward_type", rewardType);
    if (!rewardType && !includeAvatarRewards) query = query.neq("reward_type", "avatar");

    const { data, error } = await query;
    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
  } catch (error) {
    console.error("Error fetching CRM rewards:", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const payload = rewardSchema.parse(await request.json());
    const db = createPgClient();
    const { data, error } = await db
      .from("crm_rewards")
      .upsert(payload, { onConflict: "code" })
      .select()
      .single();

    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json(
          { success: false, error: "CRM migration belum diterapkan" },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    console.error("Error saving CRM reward:", error);
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const rewardId = request.nextUrl.searchParams.get("id");
    if (!rewardId) {
      return NextResponse.json({ success: false, error: "Reward id wajib diisi" }, { status: 400 });
    }

    const db = createPgClient();
    const { error } = await db
      .from("crm_rewards")
      .delete()
      .eq("id", rewardId);

    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json(
          { success: false, error: "CRM migration belum diterapkan" },
          { status: 409 }
        );
      }
      if (error.code === "23503") {
        return NextResponse.json(
          { success: false, error: "Reward sudah memiliki redemption dan tidak bisa dihapus. Nonaktifkan reward sebagai gantinya." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting CRM reward:", error);
    return apiErrorResponse(error);
  }
}
