import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPosSession, getApiUser } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  apiErrorResponse,
  isMissingCrmSchema,
  requireCrmConfigRole,
  toNumber,
  validationErrorResponse,
} from "@/lib/crm/server";

// Konfigurasi CRM yang boleh diubah dari UI Super Admin (EPIC-011 Fase B).
const EDITABLE_KEYS = ["topup_bonus_percent", "profile_completion_free_xp"] as const;

const updateSchema = z.object({
  topup_bonus_percent: z.number().min(0).max(100).optional(),
  profile_completion_free_xp: z.number().int().min(0).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: "Minimal satu setting harus diisi" }
);

export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const { data, error } = await db
      .from("crm_settings")
      .select("key, value, description, updated_at")
      .in("key", [...EDITABLE_KEYS]);

    if (error) {
      if (isMissingCrmSchema(error)) {
        return NextResponse.json({ success: true, data: {}, meta: { schemaReady: false } });
      }
      throw error;
    }

    const settings = Object.fromEntries(
      ((data ?? []) as Array<{ key: string; value: unknown }>).map((row) => [
        row.key,
        toNumber(row.value),
      ])
    );

    return NextResponse.json({ success: true, data: settings, meta: { schemaReady: true } });
  } catch (error) {
    console.error("Error fetching CRM settings:", error);
    return apiErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const forbidden = await requireCrmConfigRole();
  if (forbidden) return forbidden;

  try {
    const payload = updateSchema.parse(await request.json());
    const user = await getApiUser();
    const db = createPgClient();

    for (const key of EDITABLE_KEYS) {
      const value = payload[key];
      if (value === undefined) continue;

      const { error } = await db
        .from("crm_settings")
        .update({
          value,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("key", key);

      if (error) {
        if (isMissingCrmSchema(error)) {
          return NextResponse.json(
            { success: false, error: "CRM migration belum diterapkan" },
            { status: 409 }
          );
        }
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const validation = validationErrorResponse(error);
    if (validation) return validation;

    console.error("Error updating CRM settings:", error);
    return apiErrorResponse(error);
  }
}
