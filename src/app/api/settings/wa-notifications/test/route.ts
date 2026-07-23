import { NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { getSetting } from "@/lib/settings/app-settings";
import { readGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { WA_NOTIF_SETTING_KEY, parseWaNotifConfig } from "@/lib/wa/notifications-config";

/**
 * POST /api/settings/wa-notifications/test — kirim pesan uji ke semua nomor
 * penerima tersimpan. Membuktikan sambungan gateway + kebenaran nomor SEBELUM
 * owner mengandalkan notifikasi sungguhan.
 */

export async function POST() {
  try {
    await requireApiRole(["super_admin", "direksi"] as import("@/types").UserRole[]);

    const config = parseWaNotifConfig(await getSetting(WA_NOTIF_SETTING_KEY));
    if (config.recipients.length === 0) {
      return NextResponse.json(
        { error: "Belum ada nomor penerima. Simpan nomornya dulu." },
        { status: 400 }
      );
    }

    const gateway = readGatewayConfig();
    if (!gateway) {
      return NextResponse.json(
        { error: "WA Gateway belum dikonfigurasi (WA_GATEWAY_URL/TOKEN)" },
        { status: 400 }
      );
    }

    const now = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "short",
    });
    const results = [];
    for (const target of config.recipients) {
      const result = await sendGatewayText(gateway, {
        target,
        message:
          `Arkiv OS — pesan uji notifikasi.\n` +
          `Nomor ini akan menerima notifikasi bisnis otomatis.\n${now} WIB`,
      });
      results.push({ target, success: result.success, reason: result.reason ?? null });
    }

    const failed = results.filter((r) => !r.success);
    return NextResponse.json({
      data: { results, allOk: failed.length === 0 },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[wa-notif] test gagal:", error);
    return NextResponse.json({ error: "Gagal mengirim pesan uji" }, { status: 500 });
  }
}
