"use client";

import { Crown, Sparkles, Wifi } from "lucide-react";
import { useCountUp } from "../use-count-up";
import type { MemberMe } from "./member-portal-page";

/**
 * Kartu saldo ARK Coin — permukaan utama portal member.
 *
 * Digarap seperti kartu di aplikasi m-banking: gradien brand yang dalam,
 * guilloche halus, chip, dan angka saldo tabular berukuran besar. Tier
 * ditampilkan sebagai badge timbul, progres XP sebagai rel tipis di kaki
 * kartu — informasi loyalty tanpa mengganggu keterbacaan saldo.
 */

const rupiah = (value: number) => Math.round(value).toLocaleString("id-ID");
const angka = (value: number) => Math.round(value).toLocaleString("id-ID");

/** 6285880974659 → •••• 4659 (meniru penyamaran nomor kartu). */
function maskedPhone(phone: string | null): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "•••• ••••";
  return `•••• •••• ${digits.slice(-4)}`;
}

export function MemberWalletCard({ me }: { me: MemberMe }) {
  // Saldo & XP menghitung naik saat kartu dibuka — satu momen yang menegaskan
  // "ini uangmu", bukan animasi hiasan.
  const saldoBerjalan = useCountUp(me.ark_coin_balance, 1100);
  const xpBerjalan = useCountUp(me.total_xp, 900);

  const xpProgress = me.next_tier
    ? Math.min(100, Math.round((me.total_xp / me.next_tier.min_lifetime_xp) * 100))
    : 100;

  return (
    <div className="mp-rise mp-rise-1 relative overflow-hidden rounded-[22px] p-5 text-white mp-wallet">
      {/* Tekstur & kilau — dekorasi murni, tidak menangkap sentuhan. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 mp-wallet-guilloche" />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-y-0 -left-1/3 w-1/2 mp-wallet-sheen" />
      </div>

      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="mp-label text-white/85">Saldo ARK Coin</p>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-sm font-medium text-white/70">Rp</span>
              <span className="mp-figure text-[34px] font-bold leading-none">
                {rupiah(saldoBerjalan)}
              </span>
            </div>
          </div>

          {/* Chip + kontak nirsentuh: penanda visual "ini kartu". */}
          <div className="flex items-center gap-2">
            <div
              aria-hidden
              className="h-7 w-9 rounded-[6px] bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-500 shadow-inner"
            >
              <div className="mx-auto mt-1 h-[3px] w-6 rounded-full bg-amber-700/30" />
              <div className="mx-auto mt-1 h-[3px] w-6 rounded-full bg-amber-700/30" />
              <div className="mx-auto mt-1 h-[3px] w-6 rounded-full bg-amber-700/30" />
            </div>
            <Wifi aria-hidden className="size-4 rotate-90 text-white/50" />
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="mp-figure text-sm text-white/75">{maskedPhone(me.profile.phone)}</p>
            <p className="mt-1 truncate text-[15px] font-semibold tracking-wide">
              {me.profile.name?.toUpperCase() || "MEMBER"}
            </p>
          </div>

          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white ring-1 ring-inset ring-white/25 backdrop-blur">
            <Crown className="size-3" />
            {me.tier?.name ?? "Regular"}
          </span>
        </div>

        {/* Rel XP — memakai warna emas agar terbaca sebagai "poin", bukan uang. */}
        <div className="mt-5 border-t border-white/15 pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-white/85">
              <Sparkles className="size-3.5" style={{ color: "var(--mp-gold)" }} />
              <span className="mp-figure font-semibold text-white">{angka(xpBerjalan)}</span> XP
            </span>
            {me.tier && me.tier.discount_percent > 0 && (
              <span className="text-white/85">Diskon {me.tier.discount_percent}%</span>
            )}
          </div>

          {me.next_tier && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-out"
                  style={{
                    width: `${me.next_tier ? Math.min(100, Math.round((xpBerjalan / me.next_tier.min_lifetime_xp) * 100)) : xpProgress}%`,
                    background: "linear-gradient(90deg, var(--mp-gold), #fff3d1)",
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-white/80">
                <span className="mp-figure font-semibold text-white">
                  {angka(me.next_tier.xp_needed)}
                </span>{" "}
                XP lagi menuju {me.next_tier.name}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
