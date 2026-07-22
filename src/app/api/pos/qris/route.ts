import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createQrisCode, isXenditConfigured } from "@/lib/xendit/client";

// EPIC-024 — QRIS dinamis utk customer display: QR per transaksi dengan
// nominal terkunci (salah bayar mustahil). MVP: kasir tetap konfirmasi
// pembayaran manual seperti QRIS statis; auto-confirm via webhook Xendit
// menyusul bersama key produksi.

const createSchema = z.object({
  amount: z.number().positive().max(999_999_999),
});

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
    if (!isXenditConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error:
            "QRIS dinamis belum dikonfigurasi (XENDIT_SECRET_KEY) — pakai QRIS statis dulu",
        },
        { status: 503 }
      );
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Nominal tidak valid" },
        { status: 400 }
      );
    }

    const qr = await createQrisCode({
      externalId: `pos-${randomUUID()}`,
      amount: parsed.data.amount,
    });
    return NextResponse.json({
      success: true,
      data: {
        qr_id: qr.qrId,
        qr_string: qr.qrString,
        amount: qr.amount,
        expires_at: qr.expiresAt.toISOString(),
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
