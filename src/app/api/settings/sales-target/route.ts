import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import type { UserRole } from "@/types";
import { getSetting, setSetting } from "@/lib/settings/app-settings";
import {
  SALES_TARGET_SETTING_KEY,
  parseSalesTarget,
  sanitizeSalesTargetInput,
} from "@/lib/dashboard/sales-target";

/**
 * GET/PUT /api/settings/sales-target — target omzet harian & bulanan
 * (EPIC-021 Fase B). Diedit dari kartu "Bulan Berjalan" dashboard eksekutif.
 */

const ROLES: UserRole[] = ["super_admin", "direksi"];

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const config = parseSalesTarget(await getSetting(SALES_TARGET_SETTING_KEY));
    return NextResponse.json({ data: { config } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[sales-target] GET gagal:", error);
    return NextResponse.json({ error: "Gagal memuat target" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const body = (await request.json()) as { harianRp?: unknown; bulananRp?: unknown };

    const sanitized = sanitizeSalesTargetInput(body);
    if (sanitized === null) {
      return NextResponse.json(
        { error: "Nilai target tidak valid (angka Rp, maksimal 100 M)" },
        { status: 400 }
      );
    }

    const current = parseSalesTarget(await getSetting(SALES_TARGET_SETTING_KEY));
    const next = { ...current, ...sanitized };
    await setSetting(SALES_TARGET_SETTING_KEY, JSON.stringify(next));
    return NextResponse.json({ data: { config: next } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[sales-target] PUT gagal:", error);
    return NextResponse.json({ error: "Gagal menyimpan target" }, { status: 500 });
  }
}
