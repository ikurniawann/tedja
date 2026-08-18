import { NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import {
  loadPosReceiptSettingsRows,
  normalizeReceiptSettings,
} from "@/lib/pos/receipt-settings";

/**
 * GET /api/pos/receipt-settings — baris konfigurasi struk aktif untuk kasir
 * (EPIC-040). Read-only; resolusi scope dilakukan klien dari warehouse item
 * keranjang. Guard cukup sesi POS — isinya bukan rahasia (tercetak di struk),
 * penulisan tetap lewat /api/settings/receipt yang ber-guard settings.business.
 */
export async function GET() {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }
  try {
    const db = createPgClient();
    const rows = await loadPosReceiptSettingsRows(db);
    return NextResponse.json({
      success: true,
      data: rows.map((row) => normalizeReceiptSettings(row)),
    });
  } catch (error) {
    console.error("[pos/receipt-settings] GET failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
