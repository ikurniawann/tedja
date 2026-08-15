import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { getPosSession } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createPgClient } from "@/lib/pg/create-client";
import {
  createXenditDynamicQr,
  getXenditQrCode,
  getXenditQrCodeByReferenceId,
  loadActiveXenditConfig,
} from "@/lib/payments/xendit";
import { resolveCheckoutQrisAction } from "@/lib/pos/create-mixed-checkout";

// QRIS dinamis utk customer display: QR per transaksi dengan nominal terkunci.
// Secret diambil dari Settings → Payment Gateways (configuration.payment_gateways),
// sama seperti topup — bukan XENDIT_SECRET_KEY di env.

const createSchema = z.object({
  amount: z.number().positive().max(999_999_999).optional(),
  checkout_id: z.string().uuid().optional(),
}).refine((value) => value.amount != null || Boolean(value.checkout_id), {
  message: "Nominal tidak valid",
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

    let amount = parsed.data.amount;
    let referenceId = `pos-${randomUUID()}`;
    const checkoutId = parsed.data.checkout_id;

    if (checkoutId) {
      const { data: checkout, error: checkoutError } = await db
        .from("pos_checkouts")
        .select("id, total_amount, xendit_qr_id, xendit_external_id, payment_status")
        .eq("id", checkoutId)
        .maybeSingle();
      if (checkoutError) throw checkoutError;
      if (!checkout) {
        return NextResponse.json(
          { success: false, error: "Checkout tidak ditemukan" },
          { status: 404 }
        );
      }

      const checkoutTotal = Number(checkout.total_amount) || 0;
      if (checkoutTotal <= 0) {
        return NextResponse.json(
          { success: false, error: "Nominal tidak valid" },
          { status: 400 }
        );
      }
      if (amount != null && Math.abs(amount - checkoutTotal) > 1) {
        return NextResponse.json(
          { success: false, error: "Nominal QRIS harus sama dengan total checkout" },
          { status: 400 }
        );
      }
      amount = checkoutTotal;

      const qrisAction = resolveCheckoutQrisAction({
        xendit_qr_id: checkout.xendit_qr_id,
        xendit_external_id: checkout.xendit_external_id,
      });
      if (qrisAction !== "create") {
        const remote =
          qrisAction === "reuse_qr_id"
            ? await getXenditQrCode(xendit.secretKey, String(checkout.xendit_qr_id))
            : await getXenditQrCodeByReferenceId(
                xendit.secretKey,
                String(checkout.xendit_external_id)
              );
        if (qrisAction === "lookup_external_id" && remote.id && !checkout.xendit_qr_id) {
          const { error: healError } = await db
            .from("pos_checkouts")
            .update({
              xendit_qr_id: remote.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", checkoutId);
          if (healError) {
            return NextResponse.json(
              { success: false, error: "Gagal menyimpan QRIS checkout" },
              { status: 500 }
            );
          }
        }
        return NextResponse.json({
          success: true,
          data: {
            qr_id: String(remote.id || checkout.xendit_qr_id || ""),
            reference_id: String(
              (remote as { reference_id?: unknown }).reference_id ||
                checkout.xendit_external_id ||
                ""
            ),
            qr_string: String((remote as { qr_string?: unknown }).qr_string || ""),
            amount:
              Number(
                (remote as { amount?: unknown }).amount != null
                  ? (remote as { amount?: unknown }).amount
                  : amount
              ) || amount,
            expires_at: (remote as { expires_at?: unknown }).expires_at
              ? String((remote as { expires_at?: unknown }).expires_at)
              : null,
            checkout_id: checkoutId,
          },
        });
      }

      referenceId = `pos-chk-${checkoutId}`;
      const { error: reserveError } = await db
        .from("pos_checkouts")
        .update({
          xendit_external_id: referenceId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutId);
      if (reserveError) {
        return NextResponse.json(
          { success: false, error: "Gagal menyimpan QRIS checkout" },
          { status: 500 }
        );
      }
    }

    if (amount == null || amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Nominal tidak valid" },
        { status: 400 }
      );
    }

    const qr = await createXenditDynamicQr({
      secretKey: xendit.secretKey,
      referenceId,
      amount,
      callbackUrl: xendit.callbackUrl,
      description: `POS ${Math.round(amount)}`,
    });

    if (checkoutId) {
      const { error: saveError } = await db
        .from("pos_checkouts")
        .update({
          xendit_qr_id: qr.id,
          xendit_external_id: qr.reference_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutId);
      if (saveError) {
        console.error("[pos] save checkout qris ids:", saveError.message);
        return NextResponse.json(
          { success: false, error: "Gagal menyimpan QRIS checkout" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        qr_id: qr.id,
        reference_id: qr.reference_id,
        qr_string: qr.qr_string,
        amount: qr.amount,
        expires_at: qr.expires_at,
        ...(checkoutId ? { checkout_id: checkoutId } : {}),
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
