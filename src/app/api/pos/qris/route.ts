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
      if (isGatewayConfigError(err)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "QRIS belum dikonfigurasi di Settings → Payment Gateways",
          },
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

    return NextResponse.json({
      success: true,
      data: {
        qr_id: qr.id,
        qr_string: qr.qr_string,
        amount: qr.amount,
        expires_at: qr.expires_at,
      },
    });
  } catch (err) {
    console.error("[pos] create qris error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat QR pembayaran" },
      { status: 502 }
    );
  }
}
