import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { apiErrorResponse, isMissingCrmSchema, validationErrorResponse,
  requireCrmConfigRole,
} from "@/lib/crm/server";

const avatarSchema = z.object({
  code: z.string().trim().min(1).max(80).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  rarity: z.enum(["common", "rare", "epic", "legendary", "limited"]).default("common"),
  image_url: z.string().trim().url(),
  thumbnail_url: z.string().trim().url().nullable().optional(),
  required_tier_id: z.string().uuid().nullable().optional(),
  xp_cost: z.number().int().nonnegative().default(0),
  stock_total: z.number().int().nonnegative().nullable().optional(),
  stock_redeemed: z.number().int().nonnegative().default(0),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const rarity = request.nextUrl.searchParams.get("rarity");

    let query = db
      .from("crm_collectible_avatars")
      .select("*, required_tier:crm_membership_tiers(code, name, rank)")
      .order("created_at", { ascending: false });

    if (rarity) query = query.eq("rarity", rarity);

    const { data, error } = await query;
    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
  } catch (error) {
    console.error("Error fetching CRM avatars:", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const payload = avatarSchema.parse(await request.json());
    const db = createPgClient();
    const { data, error } = await db
      .from("crm_collectible_avatars")
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

    console.error("Error saving CRM avatar:", error);
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const avatarId = request.nextUrl.searchParams.get("id");
    if (!avatarId) {
      return NextResponse.json({ success: false, error: "Avatar id wajib diisi" }, { status: 400 });
    }

    const db = createPgClient();
    const { error } = await db
      .from("crm_collectible_avatars")
      .delete()
      .eq("id", avatarId);

    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json(
          { success: false, error: "CRM migration belum diterapkan" },
          { status: 409 }
        );
      }
      if (error.code === "23503") {
        return NextResponse.json(
          { success: false, error: "Avatar sudah terhubung dengan member/reward. Nonaktifkan avatar sebagai gantinya." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting CRM avatar:", error);
    return apiErrorResponse(error);
  }
}
