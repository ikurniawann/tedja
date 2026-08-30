import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getSetting } from "@/lib/settings/app-settings";
import { readGatewayConfig, sendGatewayText } from "@/lib/whatsapp/gateway";
import { WA_NOTIF_SETTING_KEY, parseWaNotifConfig } from "@/lib/wa/notifications-config";

/**
 * POST /api/settings/wa-notifications/test — kirim pesan uji ke semua nomor
 * penerima tersimpan. Membuktikan sambungan gateway + kebenaran nomor SEBELUM
 * owner mengandalkan notifikasi sungguhan.
 */

export async function POST(request: Request) {
  try {
    await requireIamMenuPrefix(IAM.settingsIntegrations);

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

    // Mode flash (owner 2026-08-23): kirim Daily Flash Report SUNGGUHAN
    // sebagai uji — default data hari INI (berjalan), atau ?date=YYYY-MM-DD.
    const body = (await request.json().catch(() => ({}))) as {
      flash?: boolean;
      date?: string;
    };

    const now = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "short",
    });

    let message =
      `Sulu In Wounderland OS — pesan uji notifikasi.\n` +
      `Nomor ini akan menerima notifikasi bisnis otomatis.\n${now} WIB`;
    if (body.flash) {
      const { buildFlashReportMessage, gatherFlashReportData } = await import(
        "@/lib/wa/flash-report"
      );
      const { todayWib } = await import("@/lib/wa/notifications-messages");
      const dateWib =
        body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayWib();
      const data = await gatherFlashReportData(dateWib);
      message = `${buildFlashReportMessage(data, dateWib)}\n\n_(uji kirim manual ${now} WIB — data ${dateWib})_`;
    }

    const results = [];
    for (const target of config.recipients) {
      const result = await sendGatewayText(gateway, { target, message });
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
