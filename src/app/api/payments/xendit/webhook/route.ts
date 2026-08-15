import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import {
  MixedCheckoutError,
  completeMixedCheckout,
  resolveXenditPaidWebhookAction,
} from "@/lib/pos/create-mixed-checkout";
import { creditPendingTopup } from "@/lib/pos/topup-credit";
import {
  extractXenditWebhookToken,
  loadActiveXenditConfig,
  parseXenditQrWebhook,
  verifyXenditWebhookToken,
} from "@/lib/payments/xendit";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Xendit QR paid / payment callback.
 * Configure this URL in Xendit Dashboard → Callbacks → QR code,
 * and optionally in Settings → Payment Gateways → Callback URL.
 */
export async function POST(request: NextRequest) {
  try {
    const db = createPgClient();
    let config;
    try {
      config = await loadActiveXenditConfig(db);
    } catch {
      return NextResponse.json({ success: false, error: "Xendit not configured" }, { status: 503 });
    }

    const incomingToken = extractXenditWebhookToken(request);
    if (!verifyXenditWebhookToken(incomingToken, config.webhookToken)) {
      return NextResponse.json({ success: false, error: "Invalid callback token" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseXenditQrWebhook(body);

    if (!parsed.paid) {
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: "not_paid",
        status: parsed.status,
      });
    }

    // Resolve pending topup by QR id or merchant reference
    let txId: string | null = null;

    if (parsed.qrId) {
      const { data } = await db
        .from("pos_wallet_transactions")
        .select("id")
        .eq("xendit_transaction_id", parsed.qrId)
        .eq("type", "topup")
        .maybeSingle();
      if (data?.id) txId = String(data.id);
    }

    if (!txId && parsed.referenceId) {
      const { data } = await db
        .from("pos_wallet_transactions")
        .select("id")
        .eq("reference_id", parsed.referenceId)
        .eq("type", "topup")
        .maybeSingle();
      if (data?.id) txId = String(data.id);
    }

    // Some payloads put QR id in `id` while payment id is nested
    if (!txId && parsed.paymentId && parsed.paymentId !== parsed.qrId) {
      const { data } = await db
        .from("pos_wallet_transactions")
        .select("id")
        .eq("xendit_transaction_id", parsed.paymentId)
        .eq("type", "topup")
        .maybeSingle();
      if (data?.id) txId = String(data.id);
    }

    let checkoutId: string | null = null;
    if (!txId && parsed.referenceId) {
      const { data: checkout } = await db
        .from("pos_checkouts")
        .select("id")
        .eq("xendit_external_id", parsed.referenceId)
        .maybeSingle();
      if (checkout?.id) checkoutId = String(checkout.id);
    }

    let childCount = 0;
    if (checkoutId) {
      const { data: children } = await db
        .from("pos_orders")
        .select("id")
        .eq("checkout_id", checkoutId);
      childCount = (children || []).length;
    }

    const action = resolveXenditPaidWebhookAction({
      topupId: txId,
      checkoutId,
      childCount,
    });

    if (action.type === "credit_topup" && txId) {
      const result = await creditPendingTopup(db, {
        transactionId: txId,
        xenditPaymentId: parsed.paymentId || parsed.qrId,
        notes: "Top-up QRIS",
      });

      return NextResponse.json({
        success: true,
        data: {
          topup_id: txId,
          credit_status: result.status,
          balance_after: "balance_after" in result ? result.balance_after : undefined,
        },
      });
    }

    if (action.type === "noop_checkout") {
      return NextResponse.json({
        success: true,
        ignored: true,
        reason: "checkout_children_exist",
        data: { checkout_id: action.checkoutId },
      });
    }

    if (action.type === "complete_checkout") {
      const result = await completeMixedCheckout(action.checkoutId);
      return NextResponse.json({
        success: true,
        data: {
          checkout_id: action.checkoutId,
          order_ids: result.orderIds,
        },
      });
    }

    console.warn("[xendit webhook] no matching topup", {
      qrId: parsed.qrId,
      referenceId: parsed.referenceId,
      paymentId: parsed.paymentId,
    });
    return NextResponse.json({
      success: true,
      ignored: true,
      reason: "topup_not_found",
    });
  } catch (error: unknown) {
    if (error instanceof MixedCheckoutError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("Xendit webhook error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

/** Xendit sometimes probes with GET when saving callback URL */
export async function GET() {
  return NextResponse.json({ success: true, service: "xendit-webhook" });
}
