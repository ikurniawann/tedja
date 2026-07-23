import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  DEFAULT_POS_LOYALTY_SETTINGS,
  normalizeLoyaltySettings,
  normalizeTopupPresets,
  POS_LOYALTY_SETTINGS_SINGLETON_ID,
  type PosLoyaltySettings,
} from "@/lib/pos/loyalty-settings";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

const updateSchema = z.object({
  ark_rate: z.number().positive(),
  topup_min_amount: z.number().nonnegative(),
  topup_presets: z.array(z.number().positive()).min(1),
  topup_xp_enabled: z.boolean(),
  topup_xp_mode: z.enum(["fixed", "per_amount"]),
  topup_xp_value: z.number().nonnegative(),
  topup_xp_amount_step: z.number().positive(),
  spend_xp_enabled: z.boolean(),
  spend_xp_amount_step: z.number().positive(),
  spend_xp_min: z.number().int().nonnegative(),
});

async function readSettings(): Promise<PosLoyaltySettings> {
  const db = createPgClient();
  const { data, error } = await db
    .from("pos_loyalty_settings")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || /does not exist/i.test(error.message || "")) {
      return { ...DEFAULT_POS_LOYALTY_SETTINGS };
    }
    throw error;
  }

  return normalizeLoyaltySettings(data as Record<string, unknown> | null);
}

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const settings = await readSettings();
    return NextResponse.json({ success: true, data: settings });
  } catch (error: unknown) {
    console.error("Error fetching loyalty settings:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = updateSchema.parse(await request.json());
    const presets = normalizeTopupPresets(body.topup_presets);
    const db = createPgClient();
    const now = new Date().toISOString();

    const payload = {
      id: POS_LOYALTY_SETTINGS_SINGLETON_ID,
      ark_rate: body.ark_rate,
      topup_min_amount: body.topup_min_amount,
      topup_presets: JSON.stringify(presets),
      topup_xp_enabled: body.topup_xp_enabled,
      topup_xp_mode: body.topup_xp_mode,
      topup_xp_value: body.topup_xp_value,
      topup_xp_amount_step: body.topup_xp_amount_step,
      spend_xp_enabled: body.spend_xp_enabled,
      spend_xp_amount_step: body.spend_xp_amount_step,
      spend_xp_min: body.spend_xp_min,
      is_active: true,
      updated_by: sessionUserId,
      updated_at: now,
    };

    const existing = await db
      .from("pos_loyalty_settings")
      .select("id")
      .eq("id", POS_LOYALTY_SETTINGS_SINGLETON_ID)
      .maybeSingle();

    if (existing.error && existing.error.code !== "42P01") throw existing.error;

    const { data, error } = existing.data
      ? await db
          .from("pos_loyalty_settings")
          .update(payload)
          .eq("id", POS_LOYALTY_SETTINGS_SINGLETON_ID)
          .select("*")
          .single()
      : await db.from("pos_loyalty_settings").insert(payload).select("*").single();

    if (error) {
      console.error("Loyalty settings write failed:", error);
      throw new Error(error.message || "Failed to save loyalty settings");
    }

    return NextResponse.json({
      success: true,
      data: normalizeLoyaltySettings(data as Record<string, unknown>),
      message: "Loyalty settings saved",
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("Error saving loyalty settings:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
