"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, Download, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Wallpaper & Badge di portal member (EPIC-014 Task 5+6). */

type Wallpaper = {
  id: string;
  name: string;
  image_url: string;
  thumbnail_url: string | null;
  owned: boolean;
  locked_reason: string | null;
  xp_needed: number;
};

type Badge = {
  id: string;
  name: string;
  image_url: string | null;
  min_lifetime_xp: number;
  owned: boolean;
  is_showcased: boolean;
};

const angka = (value: number) => Math.round(value).toLocaleString("id-ID");

export function MemberExtrasCard() {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [totalXp, setTotalXp] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    try {
      const [wRes, bRes] = await Promise.all([
        fetch("/api/member-portal/wallpapers"),
        fetch("/api/member-portal/badges"),
      ]);
      const w = await wRes.json();
      const b = await bRes.json();
      if (wRes.ok && w.success) {
        setWallpapers(w.data.items);
        setRemaining(w.data.entitlement?.remaining ?? 0);
      }
      if (bRes.ok && b.success) {
        setBadges(b.data.badges);
        setTotalXp(b.data.total_xp ?? 0);
      }
    } catch {
      setNote({ err: "Gagal memuat data" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeemWallpaper(item: Wallpaper) {
    setBusyId(item.id);
    setNote({});
    try {
      const res = await fetch("/api/member-portal/wallpapers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallpaper_id: item.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) setNote({ err: json.error ?? "Penukaran gagal" });
      else {
        setNote({ ok: `Wallpaper "${item.name}" berhasil ditukar!` });
        await load();
      }
    } catch {
      setNote({ err: "Penukaran gagal" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleShowcase(badge: Badge) {
    setBusyId(badge.id);
    try {
      const res = await fetch("/api/member-portal/badges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ badge_id: badge.id, showcased: !badge.is_showcased }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) setNote({ err: json.error ?? "Gagal menyimpan" });
      else await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {note.err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{note.err}</p>}
      {note.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{note.ok}</p>}

      {wallpapers.length > 0 && (
        <Card className="rounded-2xl border-0 bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" /> Wallpaper
            </CardTitle>
            <p className="text-xs text-gray-500">
              Tukar dengan jatah yang sama seperti artwork; yang sudah kamu miliki bisa diunduh
              resolusi penuh.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-2 gap-3">
              {wallpapers.map((item) => (
                <li key={item.id} className="overflow-hidden rounded-2xl border border-gray-200">
                  <div className="relative aspect-video bg-gray-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.thumbnail_url || item.image_url}
                      alt={item.name}
                      className={`h-full w-full object-cover ${item.owned ? "" : "opacity-40 grayscale"}`}
                      loading="lazy"
                    />
                  </div>
                  <div className="space-y-1.5 p-2.5">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    {item.owned ? (
                      <a
                        href={item.image_url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-7 w-full items-center justify-center rounded-md border text-xs font-medium hover:bg-gray-50"
                      >
                        Unduh resolusi penuh
                      </a>
                    ) : item.locked_reason === "Belum kamu miliki" ? (
                      remaining > 0 ? (
                        <Button
                          size="sm"
                          className="h-7 w-full text-xs"
                          disabled={busyId === item.id}
                          onClick={() => void redeemWallpaper(item)}
                        >
                          {busyId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Tukar dengan 1 jatah"}
                        </Button>
                      ) : (
                        <p className="text-[11px] text-gray-500">Jatah habis — kumpulkan XP lagi.</p>
                      )
                    ) : (
                      <p className="flex items-start gap-1 text-[11px] text-gray-500">
                        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {item.locked_reason}
                          {item.xp_needed > 0 && ` — kurang ${angka(item.xp_needed)} XP`}
                        </span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {badges.length > 0 && (
        <Card className="rounded-2xl border-0 bg-white/85 shadow-sm ring-1 ring-black/5 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="h-4 w-4" /> Badge Pencapaian
            </CardTitle>
            <p className="text-xs text-gray-500">
              Diberikan otomatis saat XP-mu menembus ambang — tanpa jatah. Pamerkan maksimal 3.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-3 gap-2.5">
              {badges.map((badge) => (
                <li
                  key={badge.id}
                  className={`rounded-xl border p-2 text-center ${badge.owned ? "border-amber-300 bg-amber-50/60" : "border-gray-200 opacity-60"}`}
                >
                  {badge.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={badge.image_url} alt={badge.name} className="mx-auto h-10 w-10 object-contain" />
                  ) : (
                    <Award className={`mx-auto h-10 w-10 ${badge.owned ? "text-amber-500" : "text-gray-300"}`} />
                  )}
                  <p className="mt-1 truncate text-[11px] font-semibold">{badge.name}</p>
                  <p className="text-[10px] text-gray-500">
                    {badge.owned
                      ? "Diraih!"
                      : `Butuh ${angka(badge.min_lifetime_xp)} XP (kurang ${angka(Math.max(0, badge.min_lifetime_xp - totalXp))})`}
                  </p>
                  {badge.owned && (
                    <button
                      type="button"
                      disabled={busyId === badge.id}
                      onClick={() => void toggleShowcase(badge)}
                      className={`mt-1 w-full rounded-md px-1 py-0.5 text-[10px] font-medium ${badge.is_showcased ? "bg-amber-200 text-amber-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    >
                      {badge.is_showcased ? "★ Dipamerkan" : "Pamerkan"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
