import type { DbClient } from "@/lib/pg/types";
import { awardCrmXpForTopup } from "@/lib/crm/loyalty-engine";
import {
  calculateTopupXp,
  idrToArk,
  loadPosLoyaltySettings,
} from "@/lib/pos/loyalty-settings";

export async function creditPendingTopup(
  db: DbClient,
  input: {
    transactionId: string;
    xenditPaymentId?: string | null;
    notes?: string;
  }
) {
  const { data: tx, error: txError } = await db
    .from("pos_wallet_transactions")
    .select("*")
    .eq("id", input.transactionId)
    .maybeSingle();

  if (txError) throw txError;
  if (!tx) return { status: "not_found" as const };

  const status = String((tx as { status?: string }).status || "completed");
  if (status === "completed") {
    return {
      status: "already_completed" as const,
      transaction: tx,
      balance_after: Number((tx as { balance_after?: number }).balance_after) || 0,
      xp_awarded: 0,
    };
  }
  if (status !== "pending") {
    return { status: "ignored" as const, transaction: tx, balance_after: 0, xp_awarded: 0 };
  }

  const customerId = String((tx as { customer_id: string }).customer_id);
  const amountValue = Number((tx as { amount: number }).amount) || 0;

  const { data: customer, error: customerError } = await db
    .from("pos_customers")
    .select("ark_coin_balance, total_spent")
    .eq("id", customerId)
    .single();

  if (customerError || !customer) {
    throw customerError || new Error("Customer not found");
  }

  const loyaltySettings = await loadPosLoyaltySettings(db);
  const arkCoins = idrToArk(amountValue, loyaltySettings.ark_rate);
  const balanceBefore = Number(customer.ark_coin_balance) || 0;
  const balanceAfter = balanceBefore + amountValue;
  const totalSpentAfter = Number(customer.total_spent || 0) + amountValue;

  const { error: updateCustomerError } = await db
    .from("pos_customers")
    .update({
      ark_coin_balance: balanceAfter,
      total_spent: totalSpentAfter,
      updated_at: new Date().toISOString(),
    })
    .eq("id", customerId);

  if (updateCustomerError) throw updateCustomerError;

  const metadata = {
    ...(((tx as { metadata?: Record<string, unknown> }).metadata as Record<string, unknown>) ||
      {}),
    credited_at: new Date().toISOString(),
    xendit_payment_id: input.xenditPaymentId || null,
  };

  const { data: updatedTx, error: updateTxError } = await db
    .from("pos_wallet_transactions")
    .update({
      status: "completed",
      ark_coins: arkCoins,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      notes: input.notes || (tx as { notes?: string }).notes || "Top-up QRIS",
      metadata,
      xendit_transaction_id:
        (tx as { xendit_transaction_id?: string }).xendit_transaction_id ||
        input.xenditPaymentId ||
        null,
    })
    .eq("id", input.transactionId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (updateTxError) throw updateTxError;
  if (!updatedTx) {
    // race: already completed
    return {
      status: "already_completed" as const,
      transaction: tx,
      balance_after: balanceAfter,
      xp_awarded: 0,
    };
  }

  const crmXp = await awardCrmXpForTopup(db, {
    customerId,
    topupAmountIdr: amountValue,
    transactionId: input.transactionId,
  });

  return {
    status: "completed" as const,
    transaction: updatedTx,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
    ark_coins: arkCoins,
    ark_rate: loyaltySettings.ark_rate,
    xp_awarded: crmXp.xpAwarded || calculateTopupXp(amountValue, loyaltySettings),
  };
}
