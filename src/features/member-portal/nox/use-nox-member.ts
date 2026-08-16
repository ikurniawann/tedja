"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_POS_LOYALTY_SETTINGS, idrToArkDisplay } from "@/lib/pos/loyalty-settings";

/**
 * Data member untuk portal Nox (Fase B) — menumpang API portal member yang
 * sudah ada (EPIC-011), BUKAN endpoint baru: /api/member-portal/me dan
 * /transactions. Sesi = cookie member_session hasil login OTP portal klasik;
 * login OTP di dalam Nox sendiri menyusul di Fase C.
 */

export interface NoxMemberData {
  profile: { id: string; name: string | null; phone: string | null };
  memberType: string | null;
  coins: number;
  totalXp: number;
  visitCount: number;
  tier: { code: string; name: string; discountPercent: number } | null;
  nextTier: { name: string; minLifetimeXp: number; xpNeeded: number } | null;
}

export interface NoxWalletTxn {
  id: string;
  type: string;
  /** Sudah dalam ARK Coin — dompet wallet seluruhnya transaksi ARK. */
  amount: number;
  createdAt: string;
  notes: string | null;
}

export interface NoxOrder {
  id: string;
  orderNumber: string;
  /** Nilai dalam satuan `unit`. */
  totalAmount: number;
  /** Order yang dibayar ARK Coin tampil sebagai koin; sisanya tetap Rupiah. */
  unit: "ark" | "idr";
  createdAt: string;
}

export type NoxMemberState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "error" }
  | {
      status: "ready";
      member: NoxMemberData;
      wallet: NoxWalletTxn[];
      orders: NoxOrder[];
    };

/** Tipe kredit menambah saldo; selain itu (payment dsb.) mengurangi. */
export const CREDIT_TXN_TYPES = new Set(["topup", "topup_bonus", "refund", "bonus"]);

export function useNoxMember(): { state: NoxMemberState; reload: () => void } {
  const [state, setState] = useState<NoxMemberState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [meRes, txnRes] = await Promise.all([
        fetch("/api/member-portal/me", { cache: "no-store" }),
        fetch("/api/member-portal/transactions", { cache: "no-store" }),
      ]);

      if (meRes.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const me = await meRes.json();
      if (!meRes.ok || !me.success) throw new Error(me.error || "gagal memuat profil");

      // Saldo & wallet disimpan dalam Rupiah; portal menampilkannya sebagai
      // ARK Coin, jadi konversinya dilakukan di sini — satu kali, di adapter.
      const arkRate = Number(me.data?.ark_rate) || DEFAULT_POS_LOYALTY_SETTINGS.ark_rate;

      // Riwayat gagal ≠ portal mati: profil tetap tampil, daftar dikosongkan.
      let wallet: NoxWalletTxn[] = [];
      let orders: NoxOrder[] = [];
      if (txnRes.ok) {
        const txn = await txnRes.json();
        type WalletRow = {
          id: string;
          type: string;
          amount: number;
          created_at: string;
          notes: string | null;
        };
        type OrderRow = {
          id: string;
          order_number: string;
          total_amount: number;
          payment_method: string | null;
          created_at: string;
        };
        wallet = ((txn.data?.wallet ?? []) as WalletRow[]).map((row) => ({
          id: row.id,
          type: row.type,
          amount: idrToArkDisplay(Number(row.amount) || 0, arkRate),
          createdAt: row.created_at,
          notes: row.notes,
        }));
        orders = ((txn.data?.orders ?? []) as OrderRow[]).map((row) => {
          const totalIdr = Number(row.total_amount) || 0;
          const paidWithArk = row.payment_method === "ark_coin";
          return {
            id: row.id,
            orderNumber: row.order_number,
            totalAmount: paidWithArk ? idrToArkDisplay(totalIdr, arkRate) : totalIdr,
            unit: paidWithArk ? ("ark" as const) : ("idr" as const),
            createdAt: row.created_at,
          };
        });
      }

      const d = me.data;
      setState({
        status: "ready",
        member: {
          profile: {
            id: d.profile?.id ?? "",
            name: d.profile?.name ?? null,
            phone: d.profile?.phone ?? null,
          },
          memberType: d.member_type ?? null,
          coins: idrToArkDisplay(Number(d.ark_coin_balance) || 0, arkRate),
          totalXp: Number(d.total_xp) || 0,
          visitCount: Number(d.visit_count) || 0,
          tier: d.tier
            ? {
                code: d.tier.code,
                name: d.tier.name,
                discountPercent: Number(d.tier.discount_percent) || 0,
              }
            : null,
          nextTier: d.next_tier
            ? {
                name: d.next_tier.name,
                minLifetimeXp: Number(d.next_tier.min_lifetime_xp) || 0,
                xpNeeded: Number(d.next_tier.xp_needed) || 0,
              }
            : null,
        },
        wallet,
        orders,
      });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: load };
}
