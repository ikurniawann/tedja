"use client";

import { useState, useCallback } from "react";
import { createOrder, type CreateOrderRequest } from "@/lib/pos-api";
import type { BillChargesResult } from "@/lib/pos/billing-settings";
import type { PosCartItem } from "./use-pos-cart";

export interface PaymentResult {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  total: number;
  change: number;
  error?: string;
  snapshotCart: PosCartItem[];
  snapshotOrderType: string;
  snapshotTable: string | null;
  snapshotNotes: string;
  xpEarned?: number;
  /** EPIC-034 Fase B — kartu yang terbit dari order ini (kode dicetak struk). */
  giftCards?: Array<{ code: string; initial_value: number; expires_at: string | null }>;
  /** Terisi bila order LUNAS tapi kartu gagal terbit — wajib ditampilkan. */
  giftCardError?: string | null;
}

export function usePosCheckout() {
  const [submitting, setSubmitting] = useState(false);

  const checkout = useCallback(
    async ({
      cart,
      orderType,
      selectedTable,
      selectedCustomer,
      paymentMethod,
      cashReceived,
      includeTax,
      notes,
      arkToUse,
      shiftId,
      nfcTabUid,
      giftCardCode,
      giftCardBuyer,
      promo,
      billCharges,
    }: {
      cart: PosCartItem[];
      orderType: string;
      selectedTable: string | null;
      selectedCustomer: { id: string; discount?: number } | null;
      paymentMethod: string;
      cashReceived: string;
      includeTax: boolean;
      notes: string;
      arkToUse: number;
      shiftId?: string | null;
      /** UID gelang ticketing — wajib saat paymentMethod 'nfc_tab' */
      nfcTabUid?: string;
      /** EPIC-034 Fase C — kode kartu, wajib saat paymentMethod 'gift_card' */
      giftCardCode?: string;
      /** EPIC-034 Fase B — pembeli gift card; nomor dipakai kirim kode via WA */
      giftCardBuyer?: { name?: string | null; phone?: string | null } | null;
      /** EPIC-032 C2 — kode promo ter-apply (diskon preview dari server). */
      promo?: { code: string; discount: number } | null;
      /** Resolved billing totals from calculateBillCharges */
      billCharges: BillChargesResult;
    }): Promise<PaymentResult> => {
      const snap = {
        snapshotCart: [...cart],
        snapshotOrderType: orderType,
        snapshotTable: selectedTable,
        snapshotNotes: notes,
      };

      try {
        setSubmitting(true);

        // Build item payload with price adjustments broken out for server validation
        const items = cart.map((item) => ({
          product_id: item.productId,
          product_name: item.name,
          product_sku: `SKU-${item.productId}`,
          variants: item.variantName ? [{ name: item.variantName, group: "Size", price: item.variantPriceAdj || 0 }] : [],
          modifiers: item.modifierNames?.map((name, idx) => ({
            name,
            group: `Option-${idx}`,
          })) || [],
          quantity: Number(item.quantity),
          unit_price: Number(item.price - (item.variantPriceAdj || 0) - (item.modifierPriceAdj || 0)),
          variant_price_adjustment: item.variantPriceAdj || 0,
          modifier_price_adjustment: item.modifierPriceAdj || 0,
          subtotal: Number(item.price * item.quantity),
          total_amount: Number(item.price * item.quantity),
        }));

        // Client-side pre-calc for reference (server recalculates discount; charges from billing config)
        const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const discountPct = selectedCustomer?.discount || 0;
        const membershipAmt = discountPct > 0 ? Math.floor((subtotal * discountPct) / 100) : 0;
        // EPIC-032 C2 — promo menumpuk di atas membership, dicap agar total ≥ 0.
        // Rumus WAJIB identik dgn server (orders route) — selisih > 1 ditolak.
        const promoAmt = promo
          ? Math.min(promo.discount, Math.max(0, subtotal - membershipAmt))
          : 0;
        const discountAmount = membershipAmt + promoAmt;
        const tax = billCharges.tax_amount;
        const total = billCharges.total;
        const paidAmount =
          paymentMethod === "cash"
            ? Number(parseFloat(cashReceived) || total)
            : paymentMethod === "nfc_tab"
              ? 0 // tagihan pindah ke tab ticketing — kasir tidak menerima uang
              : paymentMethod === "gift_card"
                ? 0 // dibayar dari saldo kartu — laci kasir tidak menerima uang
                : total;

        const payload: CreateOrderRequest = {
          order_type: orderType as CreateOrderRequest["order_type"],
          customer_id: selectedCustomer?.id,
          cashier_id: "00000000-0000-0000-0000-000000000001",
          table_id: selectedTable || undefined,
          items,
          subtotal,
          discount_amount: discountAmount,
          tax_amount: tax,
          service_charge_amount: billCharges.service_charge_amount,
          other_charges_amount: billCharges.other_charges_amount,
          charges_breakdown: billCharges.breakdown,
          total_amount: total,
          payment_method: paymentMethod === "qris" ? "qris" : paymentMethod === "credit_card" ? "credit" : paymentMethod === "ark_coin" ? "ark_coin" : paymentMethod === "nfc_tab" ? "nfc_tab" : paymentMethod === "gift_card" ? "gift_card" : "cash",
          amount_paid: paidAmount,
          include_tax: includeTax,
          membership_discount_pct: discountPct,
          promo_code: promo?.code,
          notes,
          ark_coins_used: paymentMethod === "ark_coin" ? arkToUse : 0,
          shift_id: shiftId || undefined,
          nfc_tab_uid: paymentMethod === "nfc_tab" ? nfcTabUid : undefined,
          gift_card_code: paymentMethod === "gift_card" ? giftCardCode : undefined,
          gift_card_buyer_name: giftCardBuyer?.name || undefined,
          gift_card_buyer_phone: giftCardBuyer?.phone || undefined,
        };

        const response = await createOrder(payload);

        if (!response.success) {
          return { success: false, total, change: 0, error: response.error || "Gagal membuat order", ...snap };
        }

        const change = paymentMethod === "cash" ? (parseFloat(cashReceived) || 0) - total : 0;

        return {
          success: true,
          orderId: response.data?.order_id || response.data?.id,
          orderNumber: response.data?.order_number,
          total,
          change,
          xpEarned: response.data?.xp_earned,
          giftCards: response.gift_cards,
          giftCardError: response.gift_card_error ?? null,
          ...snap,
        };
      } catch (err: unknown) {
        return {
          success: false,
          total: 0,
          change: 0,
          error: err instanceof Error ? err.message : "Network error",
          ...snap,
        };
      } finally {
        setSubmitting(false);
      }
    },
    []
  );

  return { checkout, submitting };
}
