"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2, Lock, Sparkles, Ticket, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * EPIC-011 Fase F — katalog reward di portal member.
 * XP tidak berkurang saat redeem; angka XP hanya syarat kelayakan.
 */

interface PortalReward {
  id: string;
  code: string;
  name: string;
  reward_type: string;
  min_xp: number;
  required_tier_name: string | null;
  quota_period_label: string;
  max_redemptions_per_member: number | null;
  eligible: boolean;
  reason: string | null;
  xp_needed: number;
  remaining_stock: number | null;
  remaining_quota: number | null;
}

interface PortalRedemption {
  id: string;
  redemption_number: string;
  status: "pending" | "approved" | "fulfilled" | "cancelled" | "expired";
  requested_at: string;
  fulfilled_at: string | null;
  reward_name: string;
  reward_type: string;
}

const STATUS_LABELS: Record<PortalRedemption["status"], string> = {
  pending: "Menunggu diproses",
  approved: "Siap diambil",
  fulfilled: "Sudah diambil",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
};

const STATUS_STYLES: Record<PortalRedemption["status"], string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-sky-50 text-sky-700",
  fulfilled: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-gray-100 text-gray-500",
  expired: "bg-gray-100 text-gray-500",
};

const angka = (value: number) => Math.round(value).toLocaleString("id-ID");
const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export function MemberRewardsCard({ onRedeemed }: { onRedeemed?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [rewards, setRewards] = useState<PortalReward[]>([]);
  const [history, setHistory] = useState<PortalRedemption[]>([]);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ error: string | null; message: string | null }>({
    error: null,
    message: null,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/member-portal/rewards", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal memuat rewards");
      }
      setRewards(json.data?.rewards ?? []);
      setHistory(json.data?.history ?? []);
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal memuat rewards",
        message: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeem(reward: PortalReward) {
    setRedeemingId(reward.id);
    setFeedback({ error: null, message: null });

    try {
      const res = await fetch("/api/member-portal/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reward_id: reward.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Gagal mengajukan redeem");
      }

      setFeedback({
        error: null,
        message: `${reward.name} berhasil diajukan. Tunjukkan kode ${json.data?.redemption_number ?? ""} ke kasir.`,
      });
      await load();
      onRedeemed?.();
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal mengajukan redeem",
        message: null,
      });
    } finally {
      setRedeemingId(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-purple-500" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="h-4 w-4" /> Tukar Reward
          </CardTitle>
          <p className="text-xs text-gray-500">
            XP kamu <span className="font-semibold text-purple-600">tidak berkurang</span> saat
            menukar reward — XP hanya menentukan reward apa yang bisa kamu ambil.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {feedback.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{feedback.error}</p>
          )}
          {feedback.message && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {feedback.message}
            </p>
          )}

          {rewards.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              Belum ada reward yang tersedia.
            </p>
          ) : (
            rewards.map((reward) => (
              <div
                key={reward.id}
                className={`rounded-xl border p-3 ${
                  reward.eligible ? "border-purple-200 bg-purple-50/40" : "border-gray-200 bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{reward.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> min {angka(reward.min_xp)} XP
                      </span>
                      {reward.required_tier_name && <span>· {reward.required_tier_name}</span>}
                      {reward.max_redemptions_per_member != null && (
                        <span>
                          · {reward.max_redemptions_per_member}x {reward.quota_period_label.toLowerCase()}
                        </span>
                      )}
                    </p>
                    {reward.remaining_quota != null && reward.eligible && (
                      <p className="mt-1 text-xs text-purple-600">
                        Sisa jatah kamu: {reward.remaining_quota}x
                      </p>
                    )}
                    {!reward.eligible && reward.reason && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
                        <Lock className="h-3 w-3" />
                        {reward.reason}
                        {reward.xp_needed > 0 && ` — kurang ${angka(reward.xp_needed)} XP`}
                      </p>
                    )}
                  </div>

                  <Button
                    size="sm"
                    disabled={!reward.eligible || redeemingId === reward.id}
                    onClick={() => void redeem(reward)}
                    className="shrink-0"
                  >
                    {redeemingId === reward.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Tukar"
                    )}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4" /> Reward Saya
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {history.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.reward_name}</p>
                  <p className="text-xs text-gray-400">
                    <span className="font-mono">{item.redemption_number}</span> ·{" "}
                    {tanggal(item.requested_at)}
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${STATUS_STYLES[item.status]}`}
                >
                  {item.status === "fulfilled" && <CheckCircle2 className="h-3 w-3" />}
                  {STATUS_LABELS[item.status]}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
