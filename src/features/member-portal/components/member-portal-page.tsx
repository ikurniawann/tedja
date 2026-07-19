"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Wallet, LogOut, Loader2, Crown, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberLoginCard } from "./member-login-card";
import { MemberProfileCard } from "./member-profile-card";
import { MemberRewardsCard } from "./member-rewards-card";

/** Bentuk respons GET /api/member-portal/me */
export interface MemberMe {
  profile: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    birth_date: string | null;
    gender: string | null;
    city: string | null;
    photo_url: string | null;
    wa_consent: boolean | null;
  };
  member_type: "registered" | "card";
  ark_coin_balance: number;
  total_xp: number;
  visit_count: number;
  tier: { code: string; name: string; discount_percent: number } | null;
  next_tier: { name: string; min_lifetime_xp: number; xp_needed: number } | null;
  completion: { percent: number; complete: boolean; missing_labels: string[] };
  free_xp_granted: boolean;
  free_xp_amount: number;
}

interface WalletRow {
  id: string;
  type: string;
  amount: number;
  balance_after: number;
  notes: string | null;
  created_at: string;
}
interface OrderRow {
  id: string;
  order_number: string | null;
  total_amount: number;
  payment_method: string | null;
  status: string;
  created_at: string;
}

const rupiah = (value: number) =>
  `Rp ${Math.round(value).toLocaleString("id-ID")}`;
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const WALLET_LABELS: Record<string, string> = {
  topup: "Topup",
  topup_bonus: "Bonus Topup",
  payment: "Pembayaran",
  purchase: "Pembayaran",
};

export function MemberPortalPage() {
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<MemberMe | null>(null);
  const [transactions, setTransactions] = useState<{
    wallet: WalletRow[];
    orders: OrderRow[];
  } | null>(null);
  const [tab, setTab] = useState<"beranda" | "rewards" | "profil" | "riwayat">("beranda");

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/member-portal/me");
      if (!res.ok) {
        setMe(null);
        return;
      }
      const json = await res.json();
      setMe(json.data);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (!me || tab !== "riwayat" || transactions) return;
    fetch("/api/member-portal/transactions")
      .then((res) => res.json())
      .then((json) => setTransactions(json.data ?? { wallet: [], orders: [] }))
      .catch(() => setTransactions({ wallet: [], orders: [] }));
  }, [me, tab, transactions]);

  async function logout() {
    await fetch("/api/member-portal/logout", { method: "POST" });
    setMe(null);
    setTransactions(null);
    setTab("beranda");
  }

  if (checking) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!me) {
    return <MemberLoginCard onSuccess={loadMe} />;
  }

  const xpProgress = me.next_tier
    ? Math.min(
        100,
        Math.round((me.total_xp / me.next_tier.min_lifetime_xp) * 100)
      )
    : 100;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-purple-500">
            Sulu Wonderland
          </p>
          <h1 className="text-xl font-bold text-gray-900">
            Halo, {me.profile.name?.split(" ")[0] ?? "Member"} 👋
          </h1>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Keluar">
          <LogOut className="h-5 w-5 text-gray-500" />
        </Button>
      </header>

      {/* Kartu saldo & tier */}
      <Card className="border-0 bg-gradient-to-br from-purple-600 to-fuchsia-500 text-white shadow-lg">
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-purple-100">Saldo ARK Coin</p>
              <p className="text-3xl font-bold">
                {rupiah(me.ark_coin_balance)}
              </p>
            </div>
            <Wallet className="h-8 w-8 text-purple-200" />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 font-semibold">
              <Crown className="h-4 w-4" /> {me.tier?.name ?? "Regular"}
              {me.tier && me.tier.discount_percent > 0
                ? ` · diskon ${me.tier.discount_percent}%`
                : ""}
            </span>
            <span className="inline-flex items-center gap-1 font-semibold">
              <Sparkles className="h-4 w-4" /> {me.total_xp.toLocaleString("id-ID")} XP
            </span>
          </div>
          {me.next_tier && (
            <div>
              <div className="h-2 rounded-full bg-white/25">
                <div
                  className="h-2 rounded-full bg-amber-300"
                  style={{ width: `${xpProgress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-purple-100">
                {me.next_tier.xp_needed.toLocaleString("id-ID")} XP lagi menuju{" "}
                {me.next_tier.name}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!me.free_xp_granted && me.free_xp_amount > 0 && (
        <button
          onClick={() => setTab("profil")}
          className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800"
        >
          🎁 Lengkapi profil Anda ({me.completion.percent}%) dan dapatkan{" "}
          <span className="font-bold">{me.free_xp_amount} Free XP!</span>
        </button>
      )}

      {/* Tab bar */}
      <nav className="grid grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1 text-sm font-medium">
        {(
          [
            ["beranda", "Beranda"],
            ["rewards", "Reward"],
            ["profil", "Profil"],
            ["riwayat", "Riwayat"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-lg px-3 py-2 transition ${
              tab === value ? "bg-white shadow text-purple-700" : "text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "beranda" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ringkasan</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-purple-50 p-3">
              <p className="text-xs text-gray-500">Tipe Member</p>
              <p className="font-semibold">
                {me.member_type === "card" ? "Member Kartu" : "Member Terdaftar"}
              </p>
            </div>
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-xs text-gray-500">Kunjungan</p>
              <p className="font-semibold">{me.visit_count}×</p>
            </div>
            {me.member_type !== "card" && (
              <p className="col-span-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                Tautkan kartu member di kasir untuk bisa topup ARK Coin &
                mengumpulkan XP dari transaksi.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "rewards" && <MemberRewardsCard onRedeemed={loadMe} />}

      {tab === "profil" && (
        <MemberProfileCard me={me} onSaved={loadMe} />
      )}

      {tab === "riwayat" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> Riwayat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!transactions && (
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" />
            )}
            {transactions && transactions.wallet.length === 0 &&
              transactions.orders.length === 0 && (
                <p className="py-4 text-center text-gray-400">
                  Belum ada transaksi.
                </p>
              )}
            {transactions?.wallet.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">
                    {WALLET_LABELS[row.type] ?? row.type}
                  </p>
                  <p className="text-xs text-gray-400">{tanggal(row.created_at)}</p>
                </div>
                <p
                  className={`font-semibold ${
                    row.type.startsWith("topup") ? "text-emerald-600" : "text-gray-800"
                  }`}
                >
                  {row.type.startsWith("topup") ? "+" : "−"}
                  {rupiah(Math.abs(row.amount))}
                </p>
              </div>
            ))}
            {transactions && transactions.orders.length > 0 && (
              <>
                <p className="pt-2 text-xs font-semibold uppercase text-gray-400">
                  Pembelian
                </p>
                {transactions.orders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">
                        {order.order_number ?? order.id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {tanggal(order.created_at)} ·{" "}
                        {(order.payment_method ?? "").replace("_", " ")}
                      </p>
                    </div>
                    <p className="font-semibold">{rupiah(order.total_amount)}</p>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <p className="pb-2 pt-4 text-center text-[11px] text-gray-400">
        Sulu Indo Wonderland · Portal Member
      </p>
    </div>
  );
}
