import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import { SETTING_KEYS, getSettings, maskSecret, setSetting } from "@/lib/settings/app-settings";
import { resetGoogleTokenCache } from "@/lib/crm/google-business-client";

/**
 * EPIC-013 Fase A — kredensial Google Business Profile, diisi dari UI.
 *
 * Aturan keras: **rahasia tidak pernah dikirim balik ke browser**. GET hanya
 * mengembalikan penanda "sudah terisi" dan versi tersamar; field yang
 * dikosongkan saat menyimpan berarti "biarkan nilai lama", bukan "hapus".
 */

const SECRET_KEYS = [
  SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET,
  SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN,
] as const;

const updateSchema = z.object({
  client_id: z.string().trim().max(300).optional(),
  client_secret: z.string().trim().max(300).optional(),
  refresh_token: z.string().trim().max(600).optional(),
  account_id: z.string().trim().max(200).optional(),
  location_id: z.string().trim().max(200).optional(),
});

async function requireSuperAdmin() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }
  if (user.role !== "super_admin") {
    return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
  }
  return null;
}

/** Normalisasi: terima "accounts/123" maupun "123". */
function withPrefix(value: string, prefix: "accounts" | "locations"): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  return trimmed.startsWith(`${prefix}/`) ? trimmed : `${prefix}/${trimmed}`;
}

export async function GET() {
  const forbidden = await requireSuperAdmin();
  if (forbidden) return forbidden;

  try {
    const stored = await getSettings([
      SETTING_KEYS.GOOGLE_BP_CLIENT_ID,
      SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET,
      SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN,
      SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID,
      SETTING_KEYS.GOOGLE_BP_LOCATION_ID,
    ]);

    const clientId = stored[SETTING_KEYS.GOOGLE_BP_CLIENT_ID] ?? "";
    const accountId = stored[SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID] ?? "";
    const locationId = stored[SETTING_KEYS.GOOGLE_BP_LOCATION_ID] ?? "";

    return NextResponse.json({
      success: true,
      data: {
        // Nilai non-rahasia boleh tampil utuh agar mudah diperiksa.
        client_id: clientId,
        account_id: accountId,
        location_id: locationId,
        // Rahasia: hanya penanda + samaran.
        has_client_secret: Boolean(stored[SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET]),
        client_secret_masked: maskSecret(stored[SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET]),
        has_refresh_token: Boolean(stored[SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN]),
        refresh_token_masked: maskSecret(stored[SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN]),
        configured: Boolean(
          clientId &&
            accountId &&
            locationId &&
            stored[SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET] &&
            stored[SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN]
        ),
      },
    });
  } catch (error) {
    console.error("Error reading Google Business config:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat konfigurasi" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const forbidden = await requireSuperAdmin();
  if (forbidden) return forbidden;

  try {
    const payload = updateSchema.parse(await request.json());

    const updates: [string, string][] = [];
    if (payload.client_id !== undefined) {
      updates.push([SETTING_KEYS.GOOGLE_BP_CLIENT_ID, payload.client_id]);
    }
    if (payload.account_id !== undefined) {
      updates.push([SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID, withPrefix(payload.account_id, "accounts")]);
    }
    if (payload.location_id !== undefined) {
      updates.push([
        SETTING_KEYS.GOOGLE_BP_LOCATION_ID,
        withPrefix(payload.location_id, "locations"),
      ]);
    }
    // Rahasia hanya ditulis bila benar-benar diisi — field kosong berarti
    // "jangan ubah", supaya menyimpan perubahan lain tidak menghapus token.
    if (payload.client_secret) {
      updates.push([SETTING_KEYS.GOOGLE_BP_CLIENT_SECRET, payload.client_secret]);
    }
    if (payload.refresh_token) {
      updates.push([SETTING_KEYS.GOOGLE_BP_REFRESH_TOKEN, payload.refresh_token]);
    }

    for (const [key, value] of updates) {
      await setSetting(key, value || null);
    }

    // Kredensial berubah → token lama tidak boleh dipakai lagi.
    resetGoogleTokenCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Payload tidak valid" }, { status: 400 });
    }
    console.error("Error saving Google Business config:", error);
    return NextResponse.json({ success: false, error: "Gagal menyimpan" }, { status: 500 });
  }
}

/** Hapus seluruh kredensial (mis. saat berpindah akun/lokasi). */
export async function DELETE() {
  const forbidden = await requireSuperAdmin();
  if (forbidden) return forbidden;

  for (const key of [
    SETTING_KEYS.GOOGLE_BP_CLIENT_ID,
    SETTING_KEYS.GOOGLE_BP_ACCOUNT_ID,
    SETTING_KEYS.GOOGLE_BP_LOCATION_ID,
    ...SECRET_KEYS,
  ]) {
    await setSetting(key, null);
  }
  resetGoogleTokenCache();

  return NextResponse.json({ success: true });
}
