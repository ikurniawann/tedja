import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, requireApiRole, ApiError } from "@/lib/api/auth";
import { requireCrmCampaign } from "@/lib/crm/server";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import { parseCampaignConfig } from "@/lib/crm/campaigns";
import { CAMPAIGN_CONFIG_KEY } from "@/lib/crm/campaigns-server";

// EPIC-033 — konfigurasi pengirim kampanye. GET: super_admin + marketing.
// PUT (termasuk MASTER SWITCH `enabled`): SUPER_ADMIN SAJA — menyalakan
// pengiriman = keputusan berisiko ban nomor WA (keputusan owner 26 Jul:
// tetap MATI sampai WA official siap).

export async function GET() {
  const { error } = await requireCrmCampaign();
  if (error) return error;
  try {
    const raw = await getSetting(CAMPAIGN_CONFIG_KEY);
    const config = parseCampaignConfig(raw ? JSON.parse(String(raw)) : null);
    return successResponse(config);
  } catch (err) {
    console.error("[crm-campaign] config get error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat konfigurasi" },
      { status: 500 }
    );
  }
}

const putSchema = z.object({
  enabled: z.boolean().optional(),
  daily_cap: z.number().int().min(1).max(2000).optional(),
});

export async function PUT(request: NextRequest) {
  try {
    await requireApiRole(["super_admin"]);
    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed" },
        { status: 400 }
      );
    }
    const raw = await getSetting(CAMPAIGN_CONFIG_KEY);
    const current = parseCampaignConfig(raw ? JSON.parse(String(raw)) : null);
    const next = { ...current, ...parsed.data };
    await setSetting(CAMPAIGN_CONFIG_KEY, JSON.stringify(next));
    return successResponse(next, "Konfigurasi tersimpan");
  } catch (err) {
    if (err instanceof ApiError) return err.toResponse();
    console.error("[crm-campaign] config put error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan konfigurasi" },
      { status: 500 }
    );
  }
}
