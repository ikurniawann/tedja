import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser } from "@/lib/api/auth";
import {
  getGatewayStatus,
  invalidateGatewayConfigCache,
  loadGatewayConfig,
} from "@/lib/whatsapp";
import {
  SETTING_KEYS,
  getSettings,
  maskSecret,
  setSetting,
} from "@/lib/settings/app-settings";

/**
 * Proxy status & QR pairing gateway WhatsApp untuk halaman Settings.
 *
 * Kenapa proxy: gateway hanya mendengar di 127.0.0.1 dan ber-token — browser
 * tidak boleh (dan tidak bisa) memanggilnya langsung. Token tetap di server.
 *
 * HANYA super_admin: string QR adalah kredensial sesi WhatsApp — siapa pun
 * yang memindainya menjadikan nomor bisnis tertaut ke perangkatnya.
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }
  if (user.role !== "super_admin") {
    return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
  }

  // Konfigurasi tersimpan (DB) — ditampilkan di form. Token hanya versi
  // tersamar: rahasia tidak pernah dikirim balik ke browser.
  const stored = await getSettings([
    SETTING_KEYS.WA_GATEWAY_URL,
    SETTING_KEYS.WA_GATEWAY_TOKEN,
  ]);
  const settings = {
    url: stored[SETTING_KEYS.WA_GATEWAY_URL] ?? "",
    token_masked: maskSecret(stored[SETTING_KEYS.WA_GATEWAY_TOKEN]),
    token_from_env: !stored[SETTING_KEYS.WA_GATEWAY_TOKEN] && Boolean(process.env.WA_GATEWAY_TOKEN),
  };

  const config = await loadGatewayConfig();
  if (!config) {
    return NextResponse.json({
      success: true,
      data: { configured: false, status: null, qr: null, settings },
    });
  }

  const status = await getGatewayStatus(config);
  if (!status) {
    return NextResponse.json({
      success: true,
      data: {
        configured: true,
        reachable: false,
        status: null,
        qr: null,
        settings,
      },
    });
  }

  let qr: string | null = null;
  if (!status.connected) {
    try {
      const response = await fetch(`${config.baseUrl}/qr`, {
        headers: { "x-gateway-token": config.token },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const json = await response.json();
        qr = typeof json?.qr === "string" ? json.qr : null;
      }
    } catch {
      // QR belum tersedia — status tetap dikembalikan.
    }
  }

  return NextResponse.json({
    success: true,
    data: { configured: true, reachable: true, status, qr, settings },
  });
}

const updateSchema = z.object({
  url: z.string().trim().max(300).optional(),
  token: z.string().trim().max(300).optional(),
});

/**
 * Simpan konfigurasi gateway ke configuration.app_settings.
 *
 * Aturan field mengikuti pola Google BP: token yang DIKOSONGKAN saat submit
 * berarti "biarkan nilai lama" — bukan "hapus" — supaya form bisa disimpan
 * ulang tanpa mengetik ulang rahasia. URL kosong = kembali ke default/ENV.
 */
export async function PATCH(request: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }
  if (user.role !== "super_admin") {
    return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Payload tidak valid" }, { status: 400 });
  }

  const { url, token } = parsed.data;

  if (url !== undefined) {
    if (url && !/^https?:\/\//.test(url)) {
      return NextResponse.json(
        { success: false, error: "URL harus diawali http:// atau https://" },
        { status: 400 }
      );
    }
    await setSetting(SETTING_KEYS.WA_GATEWAY_URL, url || null);
  }
  if (token) {
    await setSetting(SETTING_KEYS.WA_GATEWAY_TOKEN, token);
  }

  // Cache config di-flush supaya nilai baru langsung terpakai — tanpa ini,
  // tombol "Cek koneksi" masih memakai config lama sampai 30 detik.
  invalidateGatewayConfigCache();

  const config = await loadGatewayConfig();
  const status = config ? await getGatewayStatus(config) : null;

  return NextResponse.json({
    success: true,
    data: { configured: Boolean(config), reachable: Boolean(status), status },
  });
}
