import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/api/auth";
import { getGatewayStatus, readGatewayConfig } from "@/lib/whatsapp";

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

  const config = readGatewayConfig();
  if (!config) {
    return NextResponse.json({
      success: true,
      data: { configured: false, status: null, qr: null },
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
    data: { configured: true, reachable: true, status, qr },
  });
}
