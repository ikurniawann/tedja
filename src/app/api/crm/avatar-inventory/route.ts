import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { apiErrorResponse, isMissingCrmSchema, toNumber, validationErrorResponse } from "@/lib/crm/server";
import { checkAvatarEligibility } from "@/lib/crm/collectibles-server";
import { getPool } from "@/lib/db";

const grantAvatarSchema = z.object({
  action: z.literal("grant"),
  member_id: z.string().uuid(),
  avatar_id: z.string().uuid(),
  acquisition_source: z.enum(["manual", "campaign", "partner"]).default("manual"),
  equip: z.boolean().default(false),
  note: z.string().trim().max(240).optional(),
});

const equipAvatarSchema = z.object({
  member_id: z.string().uuid(),
  inventory_id: z.string().uuid().optional(),
  avatar_id: z.string().uuid().optional(),
}).refine((value) => value.inventory_id || value.avatar_id, {
  message: "inventory_id atau avatar_id wajib diisi",
  path: ["inventory_id"],
});

type TierRow = {
  id: string;
  code: string;
  name: string;
  rank: number | string | null;
};

type MemberRow = {
  id: string;
  customer_id: string | null;
  lifetime_xp: number | string | null;
  active_avatar_id: string | null;
  tier?: TierRow | TierRow[] | null;
};

type AvatarRow = {
  id: string;
  code: string;
  name: string;
  rarity: string;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_id: string | null;
  xp_cost: number | string | null;
  stock_total: number | string | null;
  stock_redeemed: number | string | null;
  is_active: boolean;
  required_tier?: TierRow | TierRow[] | null;
};

function normalizeTier(tier: TierRow | TierRow[] | null | undefined) {
  return Array.isArray(tier) ? tier[0] ?? null : tier ?? null;
}

async function loadMember(
  db: import("@/lib/pg/types").DbClient,
  input: { memberId?: string; customerId?: string }
) {
  let query = db
    .from("crm_member_profiles")
    .select("id, customer_id, lifetime_xp, active_avatar_id, tier:crm_membership_tiers(id, code, name, rank)")
    .eq("status", "active");

  query = input.memberId ? query.eq("id", input.memberId) : query.eq("customer_id", input.customerId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const member = data as unknown as MemberRow;
  return {
    ...member,
    tier: normalizeTier(member.tier),
  };
}

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const memberId = request.nextUrl.searchParams.get("member_id");
    const customerId = request.nextUrl.searchParams.get("customer_id");

    if (!memberId && !customerId) {
      return NextResponse.json({ success: false, error: "member_id atau customer_id wajib diisi" }, { status: 400 });
    }

    let query = db
      .from("crm_member_avatar_inventory")
      .select("*, avatar:crm_collectible_avatars(*, required_tier:crm_membership_tiers(code, name, rank))")
      .order("acquired_at", { ascending: false });

    if (memberId) {
      query = query.eq("member_id", memberId);
    } else if (customerId) {
      const member = await loadMember(db, { customerId });
      if (!member) return NextResponse.json({ success: true, data: [], meta: { schemaReady: true } });
      query = query.eq("member_id", member.id);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json({ success: true, data: [], meta: { schemaReady: false } });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
  } catch (error) {
    console.error("Error fetching avatar inventory:", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = await request.json();
    if (body?.action === "grant") {
      return grantAvatar(body);
    }

    // Redeem avatar dengan potong XP PENSIUN (EPIC-011 Fase B): XP adalah
    // skor seumur hidup dan tidak pernah berkurang. Avatar hanya bisa
    // diberikan via grant (manual/campaign/partner).
    return NextResponse.json(
      {
        success: false,
        error: "Redeem avatar dengan XP sudah dipensiunkan — gunakan grant admin (EPIC-011)",
      },
      { status: 410 }
    );
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    console.error("Error processing avatar request:", error);
    return apiErrorResponse(error);
  }
}

async function grantAvatar(body: unknown) {
  const payload = grantAvatarSchema.parse(body);
  const db = createPgClient();
  const member = await loadMember(db, { memberId: payload.member_id });

  if (!member) {
    return NextResponse.json(
      { success: false, error: "Member CRM belum aktif. Aktifkan member terlebih dahulu." },
      { status: 409 }
    );
  }

  const existing = await db
    .from("crm_member_avatar_inventory")
    .select("id")
    .eq("member_id", member.id)
    .eq("avatar_id", payload.avatar_id)
    .maybeSingle();

  if (existing.error && !isMissingCrmSchema(existing.error)) throw existing.error;
  if (existing.data) {
    return NextResponse.json({ success: false, error: "Member sudah memiliki avatar ini" }, { status: 409 });
  }

  const { data: avatarData, error: avatarError } = await db
    .from("crm_collectible_avatars")
    .select("*, required_tier:crm_membership_tiers(id, code, name, rank)")
    .eq("id", payload.avatar_id)
    .maybeSingle();

  if (avatarError) throw avatarError;
  if (!avatarData) {
    return NextResponse.json({ success: false, error: "Avatar tidak ditemukan" }, { status: 404 });
  }

  const avatar = avatarData as unknown as AvatarRow;
  const stockTotal = avatar.stock_total == null ? null : toNumber(avatar.stock_total);
  const stockRedeemed = toNumber(avatar.stock_redeemed);

  if (!avatar.is_active) {
    return NextResponse.json({ success: false, error: "Avatar sedang tidak aktif" }, { status: 400 });
  }
  if (stockTotal !== null && stockRedeemed >= stockTotal) {
    return NextResponse.json({ success: false, error: "Stok avatar sudah habis" }, { status: 400 });
  }

  // EPIC-014 Task 2: required_tier_id + min_lifetime_xp kini DITEGAKKAN di
  // jalur grant admin juga (dulu dekoratif) — satu aturan dari modul bersama.
  if (member.customer_id) {
    const eligibility = await checkAvatarEligibility(getPool(), avatar.id, member.customer_id);
    if (!eligibility.allowed) {
      return NextResponse.json(
        { success: false, error: `Member belum memenuhi syarat: ${eligibility.reason}` },
        { status: 403 }
      );
    }
  }

  const shouldEquip = payload.equip || !member.active_avatar_id;
  if (shouldEquip) {
    const { error: unequipError } = await db
      .from("crm_member_avatar_inventory")
      .update({ is_equipped: false })
      .eq("member_id", member.id);

    if (unequipError) throw unequipError;
  }

  const { data: inventory, error: inventoryError } = await db
    .from("crm_member_avatar_inventory")
    .insert({
      member_id: member.id,
      avatar_id: avatar.id,
      redemption_id: null,
      acquisition_source: payload.acquisition_source,
      is_equipped: shouldEquip,
      metadata: {
        granted_by: "crm_admin",
        note: payload.note ?? null,
      },
    })
    .select("*, avatar:crm_collectible_avatars(*)")
    .single();

  if (inventoryError) throw inventoryError;

  const { error: memberUpdateError } = await db
    .from("crm_member_profiles")
    .update({
      active_avatar_id: shouldEquip ? avatar.id : member.active_avatar_id,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", member.id);

  if (memberUpdateError) throw memberUpdateError;

  if (stockTotal !== null) {
    const { error: avatarStockError } = await db
      .from("crm_collectible_avatars")
      .update({ stock_redeemed: stockRedeemed + 1 })
      .eq("id", avatar.id);

    if (avatarStockError) throw avatarStockError;
  }

  return NextResponse.json({ success: true, data: inventory });
}

export async function PATCH(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const payload = equipAvatarSchema.parse(await request.json());
    const db = createPgClient();

    let inventoryQuery = db
      .from("crm_member_avatar_inventory")
      .select("id, member_id, avatar_id")
      .eq("member_id", payload.member_id);

    inventoryQuery = payload.inventory_id
      ? inventoryQuery.eq("id", payload.inventory_id)
      : inventoryQuery.eq("avatar_id", payload.avatar_id);

    const { data: inventory, error: inventoryError } = await inventoryQuery.maybeSingle();
    if (inventoryError) throw inventoryError;
    if (!inventory) {
      return NextResponse.json({ success: false, error: "Avatar belum dimiliki member" }, { status: 404 });
    }

    const owned = inventory as { id: string; member_id: string; avatar_id: string };
    const { error: unequipError } = await db
      .from("crm_member_avatar_inventory")
      .update({ is_equipped: false })
      .eq("member_id", payload.member_id);

    if (unequipError) throw unequipError;

    const { error: equipError } = await db
      .from("crm_member_avatar_inventory")
      .update({ is_equipped: true })
      .eq("id", owned.id);

    if (equipError) throw equipError;

    const { error: memberUpdateError } = await db
      .from("crm_member_profiles")
      .update({
        active_avatar_id: owned.avatar_id,
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", payload.member_id);

    if (memberUpdateError) throw memberUpdateError;

    return NextResponse.json({ success: true, data: owned });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    console.error("Error equipping avatar:", error);
    return apiErrorResponse(error);
  }
}
