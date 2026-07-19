import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  CRM_DEFAULT_TIERS,
  apiErrorResponse,
  isMissingCrmSchema,
  requireCrmConfigRole,
  validationErrorResponse,
} from "@/lib/crm/server";

const tierSchema = z.object({
  code: z.string().trim().min(1).max(40).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  rank: z.number().int().nonnegative(),
  min_lifetime_xp: z.number().int().nonnegative().default(0),
  min_total_spend: z.number().nonnegative().default(0),
  xp_multiplier: z.number().nonnegative().default(1),
  discount_percent: z.number().min(0).max(100).default(0),
  benefits: z.array(z.string()).default([]),
  display_color: z.string().trim().min(1).default("#6B7280"),
  is_active: z.boolean().default(true),
});

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const { data, error } = await db
      .from("crm_membership_tiers")
      .select("*")
      .order("rank", { ascending: true });

    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json({ success: true, data: CRM_DEFAULT_TIERS, meta: { schemaReady: false } });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data: data ?? [], meta: { schemaReady: true } });
  } catch (error) {
    console.error("Error fetching CRM tiers:", error);
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const payload = tierSchema.parse(await request.json());
    const db = createPgClient();
    const { data, error } = await db
      .from("crm_membership_tiers")
      // benefits di-stringify manual: driver pg menserialisasi array JS jadi
      // literal array Postgres ("{}"), bukan JSON — jsonb butuh string JSON.
      .upsert({ ...payload, benefits: JSON.stringify(payload.benefits) }, { onConflict: "code" })
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

    console.error("Error saving CRM tier:", error);
    return apiErrorResponse(error);
  }
}
