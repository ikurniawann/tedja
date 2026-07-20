"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ImageIcon, Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * EPIC-014 Task 1 — etalase koleksi member.
 * XP tidak berkurang; XP hanya menentukan artwork apa yang bisa dikejar.
 */

type Rarity = "common" | "rare" | "epic" | "legendary" | "limited";

interface Collectible {
  id: string;
  code: string;
  name: string;
  rarity: Rarity;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_name: string | null;
  remaining_stock: number | null;
  owned: boolean;
  equipped: boolean;
  acquired_at: string | null;
  locked_reason: string | null;
  xp_needed: number;
}

const RARITY_LABELS: Record<Rarity, string> = {
  limited: "Terbatas",
  legendary: "Legendaris",
  epic: "Epik",
  rare: "Langka",
  common: "Umum",
};

const RARITY_STYLES: Record<Rarity, string> = {
  limited: "bg-rose-50 text-rose-700",
  legendary: "bg-amber-50 text-amber-700",
  epic: "bg-violet-50 text-violet-700",
  rare: "bg-sky-50 text-sky-700",
  common: "bg-slate-100 text-slate-600",
};

const angka = (value: number) => Math.round(value).toLocaleString("id-ID");

export function MemberCollectionCard({ onEquipped }: { onEquipped?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Collectible[]>([]);
  const [ownedCount, setOwnedCount] = useState(0);
  const [equippingId, setEquippingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message?: string; error?: string }>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/member-portal/collectibles");
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ error: json.error ?? "Gagal memuat koleksi" });
        return;
      }
      setItems(json.data.items);
      setOwnedCount(json.data.owned_count);
    } catch {
      setFeedback({ error: "Gagal memuat koleksi" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function equip(item: Collectible) {
    setEquippingId(item.id);
    setFeedback({});
    try {
      const res = await fetch("/api/member-portal/collectibles/equip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_id: item.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ error: json.error ?? "Gagal memasang artwork" });
        return;
      }
      setFeedback({ message: `"${item.name}" terpasang.` });
      await load();
      onEquipped?.();
    } catch {
      setFeedback({ error: "Gagal memasang artwork" });
    } finally {
      setEquippingId(null);
    }
  }

  if (loading) {
    return (
      <Card className="rounded-2xl border-0 bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur">
        <CardContent className="py-10">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[color:var(--brand-primary)]" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-0 bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" /> Koleksi Artwork
        </CardTitle>
        <p className="text-xs text-gray-500">
          {items.length > 0 && (
            <>
              Kamu punya{" "}
              <span className="font-semibold text-[color:var(--brand-primary)]">
                {ownedCount} dari {items.length}
              </span>{" "}
              artwork.{" "}
            </>
          )}
          XP kamu <span className="font-semibold">tidak berkurang</span> — XP hanya menentukan
          artwork apa yang bisa kamu kejar.
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

        {items.length === 0 ? (
          <div className="py-8 text-center">
            <ImageIcon className="mx-auto h-8 w-8 text-gray-300" />
            <p className="mt-2 text-sm text-gray-400">Belum ada artwork yang tersedia.</p>
            <p className="mt-1 text-xs text-gray-400">
              Nantikan koleksi berikutnya — kumpulkan XP dari transaksimu.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {items.map((item) => (
              <li
                key={item.id}
                className={`overflow-hidden rounded-2xl border ${
                  item.equipped
                    ? "border-[color:var(--brand-primary)] ring-1 ring-[color:var(--brand-primary)]"
                    : item.owned
                      ? "border-[color:var(--mp-line)]"
                      : "border-gray-200"
                }`}
              >
                <div className="relative aspect-square bg-gray-50">
                  {/* Artwork diunggah admin; komponen next/image dilewati karena
                      host gambar belum dibatasi di konfigurasi. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.thumbnail_url || item.image_url}
                    alt={item.name}
                    className={`h-full w-full object-cover ${item.owned ? "" : "opacity-40 grayscale"}`}
                    loading="lazy"
                  />
                  {!item.owned && (
                    <span className="absolute inset-0 grid place-items-center">
                      <Lock className="h-6 w-6 text-gray-500" />
                    </span>
                  )}
                  {item.equipped && (
                    <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-[color:var(--brand-primary)] px-2 py-0.5 text-[11px] font-semibold text-white">
                      <CheckCircle2 className="h-3 w-3" /> Dipakai
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 p-2.5">
                  <p className="truncate text-sm font-semibold text-[color:var(--mp-ink)]">
                    {item.name}
                  </p>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${RARITY_STYLES[item.rarity]}`}
                  >
                    {RARITY_LABELS[item.rarity]}
                  </span>

                  {!item.owned && item.locked_reason && (
                    <p className="flex items-start gap-1 text-[11px] text-gray-500">
                      <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        {item.locked_reason}
                        {item.xp_needed > 0 && ` — kurang ${angka(item.xp_needed)} XP`}
                      </span>
                    </p>
                  )}

                  {item.owned && !item.equipped && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-full text-xs"
                      disabled={equippingId === item.id}
                      onClick={() => void equip(item)}
                    >
                      {equippingId === item.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Pasang"
                      )}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
