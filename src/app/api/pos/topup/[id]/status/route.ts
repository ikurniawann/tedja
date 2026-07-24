import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { creditPendingTopup } from "@/lib/pos/topup-credit";
import { getXenditQrCode, loadActiveXenditConfig } from "@/lib/payments/xendit";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

// GET /api/pos/topup/[id]/status — poll pending QRIS topup
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const db = createPgClient();

    const { data: tx, error } = await db
      .from("pos_wallet_transactions")
      .select("*")
      .eq("id", id)
      .eq("type", "topup")
      .maybeSingle();

    if (error) throw error;
    if (!tx) {
      return NextResponse.json({ success: false, error: "Topup not found" }, { status: 404 });
    }

    const status = String((tx as { status?: string }).status || "completed");
    const metadata = ((tx as { metadata?: Record<string, unknown> }).metadata ||
      {}) as Record<string, unknown>;

    if (status === "pending") {
      // Optional: refresh from Xendit if QR already inactive / paid (webhook miss)
      const qrId = String((tx as { xendit_transaction_id?: string }).xendit_transaction_id || "");
      if (qrId) {
        try {
          const xendit = await loadActiveXenditConfig(db);
          const remote = await getXenditQrCode(xendit.secretKey, qrId);
          const remoteStatus = String(remote.status || "").toUpperCase();
          // When paid, webhook should have fired; if we see SUCCEEDED-like payment metadata, credit.
          if (remoteStatus === "INACTIVE" || remoteStatus === "COMPLETED") {
            // Do not auto-credit on INACTIVE alone (could be expired). Only credit via webhook
            // or explicit payment status fields if present.
            const paymentStatus = String(
              (remote as { payment_status?: string }).payment_status || ""
            ).toUpperCase();
            if (paymentStatus === "SUCCEEDED" || paymentStatus === "COMPLETED") {
              const credited = await creditPendingTopup(db, {
                transactionId: id,
                xenditPaymentId: String(
                  (remote as { payment_id?: string }).payment_id || remote.id
                ),
                notes: "Top-up QRIS",
              });
              if (credited.status === "completed" || credited.status === "already_completed") {
                const balanceBeforeFallback = Number(tx.balance_before) || 0;
                const arkCoinsFallback = Number(tx.ark_coins) || 0;
                return NextResponse.json({
                  success: true,
                  data: {
                    status: "completed",
                    topup_id: id,
                    balance_before:
                      credited.balance_before !== undefined && credited.balance_before !== null
                        ? credited.balance_before
                        : balanceBeforeFallback,
                    balance_after: credited.balance_after,
                    ark_coins:
                      credited.ark_coins !== undefined && credited.ark_coins !== null
                        ? credited.ark_coins
                        : arkCoinsFallback,
                    ark_rate: credited.ark_rate,
                    xp_awarded: credited.xp_awarded || 0,
                    transaction: credited.transaction,
                    qr_code_url: metadata.qr_string
                      ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(String(metadata.qr_string))}`
                      : null,
                  },
                });
              }
            }
          }
        } catch {
          // Ignore poll refresh errors; keep returning pending
        }
      }
    }

    const qrString = metadata.qr_string ? String(metadata.qr_string) : null;

    return NextResponse.json({
      success: true,
      data: {
        status,
        topup_id: id,
        balance_before: Number(tx.balance_before) || 0,
        balance_after: Number(tx.balance_after) || 0,
        ark_coins: Number(tx.ark_coins) || 0,
        transaction: tx,
        qr_code_url: qrString
          ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrString)}`
          : null,
        qr_string: qrString,
        expires_at: metadata.expires_at ? String(metadata.expires_at) : null,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching topup status:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
