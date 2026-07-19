import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { getSettings, setSetting, SETTING_KEYS } from "@/lib/settings/app-settings";

/**
 * GET/PUT /api/settings/company-profile — profil legal perusahaan untuk
 * dokumen kontrak kerja (nama PT, alamat, kota, penandatangan). Disimpan di
 * configuration.app_settings (key company_*).
 */

const FIELDS = {
  legal_name: SETTING_KEYS.COMPANY_LEGAL_NAME,
  address: SETTING_KEYS.COMPANY_ADDRESS,
  city: SETTING_KEYS.COMPANY_CITY,
  signer_name: SETTING_KEYS.COMPANY_SIGNER_NAME,
  signer_title: SETTING_KEYS.COMPANY_SIGNER_TITLE,
} as const;

type Field = keyof typeof FIELDS;

export async function GET() {
  try {
    await requireApiRole(["super_admin", "admin", "hrd"]);
    const settings = await getSettings(Object.values(FIELDS));
    const data = Object.fromEntries(
      (Object.keys(FIELDS) as Field[]).map((field) => [field, settings[FIELDS[field]]])
    );
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[company-profile] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireApiRole(["super_admin", "admin"]);
    const body = (await request.json()) as Record<string, unknown>;

    for (const field of Object.keys(FIELDS) as Field[]) {
      const value = body[field];
      if (value === undefined) continue;
      if (value !== null && typeof value !== "string") {
        return NextResponse.json({ error: `${field} tidak valid` }, { status: 400 });
      }
      if (typeof value === "string" && value.length > 500) {
        return NextResponse.json({ error: `${field} terlalu panjang` }, { status: 400 });
      }
      await setSetting(FIELDS[field], value ? value.trim() : null);
    }

    return NextResponse.json({ message: "Profil perusahaan tersimpan" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[company-profile] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
