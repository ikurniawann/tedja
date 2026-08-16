import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPgClient } from "@/lib/pg/create-client";
import {
  createXenditDynamicQr,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";
import { getSettings, SETTING_KEYS } from "@/lib/settings/app-settings";

// QRIS dinamis utk customer display: QR per transaksi dengan nominal terkunci.
// Secret diambil dari Settings → Payment Gateways (configuration.payment_gateways),
// sama seperti topup — bukan XENDIT_SECRET_KEY di env.

const createSchema = z.object({
  amount: z.number().positive().max(999_999_999),
});

function isGatewayConfigError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /not configured|inactive|secret key is missing/i.test(message);
}

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const rate = checkRateLimit(`pos-qris:${sessionUserId}`, 30);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan QR — tunggu sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Nominal tidak valid" },
        { status: 400 }
      );
    }

    const db = createPgClient();
    let xendit;
    try {
      xendit = await loadActiveXenditConfig(db);
    } catch (err) {
      const message = err instanceof Error ? err.message : "QRIS belum dikonfigurasi";
      console.error("[pos] qris gateway config:", message);
      if (isGatewayConfigError(err)) {
        return NextResponse.json(
          { success: false, error: message },
          { status: 503 }
        );
      }
      throw err;
    }

    const qr = await createXenditDynamicQr({
      secretKey: xendit.secretKey,
      referenceId: `pos-${randomUUID()}`,
      amount: parsed.data.amount,
      callbackUrl: xendit.callbackUrl,
      description: `POS ${Math.round(parsed.data.amount)}`,
    });

    // Identitas merchant utk dialog QRIS bergaya standar Indonesia —
    // nama jatuh ke profil legal perusahaan bila belum diisi khusus.
    const identity = await getSettings([
      SETTING_KEYS.QRIS_MERCHANT_NAME,
      SETTING_KEYS.QRIS_NMID,
      SETTING_KEYS.COMPANY_LEGAL_NAME,
    ]);

    return NextResponse.json({
      success: true,
      data: {
        qr_id: qr.id,
        qr_string: qr.qr_string,
        amount: qr.amount,
        expires_at: qr.expires_at,
        merchant_name:
          identity[SETTING_KEYS.QRIS_MERCHANT_NAME] ||
          identity[SETTING_KEYS.COMPANY_LEGAL_NAME] ||
          null,
        nmid: identity[SETTING_KEYS.QRIS_NMID] || null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal membuat QR pembayaran";
    console.error("[pos] create qris error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 }
    );
  }
}
