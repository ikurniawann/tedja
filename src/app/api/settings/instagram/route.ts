import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import { SETTING_KEYS, getSettings, maskSecret, setSetting } from "@/lib/settings/app-settings";

/**
 * EPIC-013 Fase C — kredensial Instagram Messaging, diisi dari UI.
 *
 * Mengikuti aturan yang sama seperti Google Business Profile: **rahasia tidak
 * pernah dikirim balik ke browser**. GET hanya mengembalikan penanda "sudah
 * terisi" dan versi tersamar; field rahasia yang dikosongkan saat menyimpan
 * berarti "biarkan nilai lama", bukan "hapus".
 */

const SECRET_KEYS = [SETTING_KEYS.IG_APP_SECRET, SETTING_KEYS.IG_ACCESS_TOKEN] as const;

const updateSchema = z.object({
  app_secret: z.string().trim().max(300).optional(),
  verify_token: z.string().trim().max(300).optional(),
  access_token: z.string().trim().max(1000).optional(),
  account_id: z.string().trim().max(200).optional(),
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

export async function GET() {
  const forbidden = await requireSuperAdmin();
  if (forbidden) return forbidden;

  try {
    const stored = await getSettings([
      SETTING_KEYS.IG_APP_SECRET,
      SETTING_KEYS.IG_VERIFY_TOKEN,
      SETTING_KEYS.IG_ACCESS_TOKEN,
      SETTING_KEYS.IG_ACCOUNT_ID,
    ]);

    const verifyToken = stored[SETTING_KEYS.IG_VERIFY_TOKEN] ?? "";
    const accountId = stored[SETTING_KEYS.IG_ACCOUNT_ID] ?? "";
    const appSecret = stored[SETTING_KEYS.IG_APP_SECRET];
    const accessToken = stored[SETTING_KEYS.IG_ACCESS_TOKEN];

    return NextResponse.json({
      success: true,
      data: {
        // Verify token bukan rahasia sesungguhnya — kita sendiri yang
        // menentukannya, dan harus disalin persis ke dashboard Meta.
        verify_token: verifyToken,
        account_id: accountId,
        has_app_secret: Boolean(appSecret),
        app_secret_masked: maskSecret(appSecret),
        has_access_token: Boolean(accessToken),
        access_token_masked: maskSecret(accessToken),
        // Webhook sudah bisa MENERIMA pesan begitu dua nilai ini terisi,
        // walau token pengirim belum ada. Dibedakan agar owner tahu sejauh
        // mana integrasinya sudah berjalan.
        webhook_ready: Boolean(appSecret && verifyToken),
        configured: Boolean(appSecret && verifyToken && accessToken && accountId),
      },
    });
  } catch (error) {
    console.error("Error reading Instagram config:", error);
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
    if (payload.verify_token !== undefined) {
      updates.push([SETTING_KEYS.IG_VERIFY_TOKEN, payload.verify_token]);
    }
    if (payload.account_id !== undefined) {
      updates.push([SETTING_KEYS.IG_ACCOUNT_ID, payload.account_id]);
    }
    // Rahasia hanya ditulis bila benar-benar diisi — field kosong berarti
    // "jangan ubah", supaya menyimpan perubahan lain tidak menghapus token.
    if (payload.app_secret) {
      updates.push([SETTING_KEYS.IG_APP_SECRET, payload.app_secret]);
    }
    if (payload.access_token) {
      updates.push([SETTING_KEYS.IG_ACCESS_TOKEN, payload.access_token]);
    }

    for (const [key, value] of updates) {
      await setSetting(key, value || null);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Payload tidak valid" }, { status: 400 });
    }
    console.error("Error saving Instagram config:", error);
    return NextResponse.json({ success: false, error: "Gagal menyimpan" }, { status: 500 });
  }
}

/** Hapus seluruh kredensial (mis. saat berpindah akun Instagram). */
export async function DELETE() {
  const forbidden = await requireSuperAdmin();
  if (forbidden) return forbidden;

  for (const key of [SETTING_KEYS.IG_VERIFY_TOKEN, SETTING_KEYS.IG_ACCOUNT_ID, ...SECRET_KEYS]) {
    await setSetting(key, null);
  }

  return NextResponse.json({ success: true });
}
