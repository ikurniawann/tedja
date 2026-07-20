"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { ExecutiveDashboard } from "@/lib/dashboard/executive";

/**
 * Dashboard eksekutif /dashboard (EPIC-021) — super_admin + direksi.
 * High-level & taktis lintas modul: setiap angka berpembanding dan ber-deep-link,
 * analisis dalam tetap di dashboard modul masing-masing.
 */

const REFRESH_MS = 60_000;

function formatRupiah(value: number): string {
  if (Math.abs(value) >= 1_000_000_000)
    return `Rp ${(value / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (Math.abs(value) >= 1_000_000)
    return `Rp ${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
  if (Math.abs(value) >= 1_000)
    return `Rp ${(value / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return `Rp ${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (before <= 0) return <span className="text-xs text-gray-400">{label}: —</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)}% <span className="font-normal text-gray-500">{label}</span>
    </span>
  );
}

function SectionCard({
  title,
  href,
  hrefLabel = "Buka",
  children,
  failed,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  failed?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          {href && (
            <Link href={href} className="text-xs font-semibold text-pink-600 hover:text-pink-700">
              {hrefLabel} ›
            </Link>
          )}
        </div>
        {failed ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
            Data tak terjangkau — dimuat ulang otomatis.
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export function ExecutiveDashboardPage() {
  const [data, setData] = useState<ExecutiveDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/executive");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal memuat");
      setData(json.data as ExecutiveDashboard);
      setError(null);
    } catch (e) {
      setError((prev) => (data ? prev : e instanceof Error ? e.message : "Gagal memuat"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) {
    return <div className="p-6 text-sm text-rose-600">{error}</div>;
  }

  if (!data) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-gray-100" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
        <div className="h-56 animate-pulse rounded-xl bg-gray-100" />
      </div>
    );
  }

  const o = data.overview;
  const failed = new Set(data.gagal);
  const pulsa = o.pulsaBisnis;
  const tim = o.timHariIni;
  const keputusan = o.perluKeputusan;
  const tren = data.tren14Hari;

  // Insight mingguan: 7 hari terakhir vs 7 hari sebelumnya.
  const minggu = tren
    ? {
        ini: tren.slice(7).reduce((a, p) => a + p.omzet, 0),
        lalu: tren.slice(0, 7).reduce((a, p) => a + p.omzet, 0),
      }
    : null;
  const maxOmzet = tren ? Math.max(...tren.map((p) => p.omzet), 1) : 1;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ringkasan Eksekutif</h1>
          <p className="text-sm text-gray-500">
            Seluruh modul dalam satu layar — angka mengikuti definisi modulnya, klik untuk mendalami.
          </p>
        </div>
        <p className="text-xs text-gray-400">
          Diperbarui{" "}
          {new Date(data.dibuatPada).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}{" "}
          · otomatis tiap 60 dtk
        </p>
      </div>

      {/* KPI utama */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SectionCard title="Omzet Hari Ini" href="/dashboard/pos" failed={failed.has("overview:pulsaBisnis")}>
          {pulsa && (
            <>
              <div className="text-2xl font-extrabold text-gray-900">{formatRupiah(pulsa.hariIni.omzet)}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Delta now={pulsa.hariIni.omzet} before={pulsa.kemarin.omzet} label="vs kemarin" />
                {tren && tren.length === 14 && (
                  <Delta now={pulsa.hariIni.omzet} before={tren[6].omzet} label="vs minggu lalu" />
                )}
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Pesanan Hari Ini" href="/dashboard/pos/orders" failed={failed.has("overview:pulsaBisnis")}>
          {pulsa && (
            <>
              <div className="text-2xl font-extrabold text-gray-900">{pulsa.hariIni.pesanan}</div>
              <p className="mt-2 text-xs text-gray-500">
                Rata-rata {formatRupiah(pulsa.hariIni.rataRata)} / pesanan
              </p>
            </>
          )}
        </SectionCard>

        <SectionCard title="Tim Hari Ini" href="/dashboard/hris/attendance" failed={failed.has("overview:timHariIni")}>
          {tim && (
            <>
              <div className="text-2xl font-extrabold text-gray-900">
                {tim.hadir}
                <span className="text-base font-semibold text-gray-400">/{tim.aktif} hadir</span>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {tim.terlambat} telat · {tim.belum} belum absen · {tim.cuti} cuti
              </p>
            </>
          )}
        </SectionCard>

        <SectionCard title="Menunggu Keputusan" failed={failed.has("overview:perluKeputusan")}>
          {keputusan && (
            <>
              <div className="text-2xl font-extrabold text-gray-900">{keputusan.total}</div>
              <p className="mt-2 text-xs text-gray-500">pengajuan & dokumen menunggu approval</p>
            </>
          )}
        </SectionCard>
      </div>

      {/* Tren 14 hari */}
      <SectionCard title="Tren Penjualan 14 Hari" href="/dashboard/pos" failed={failed.has("tren14")}>
        {tren && (
          <>
            <div className="flex h-36 items-end gap-1.5">
              {tren.map((p, i) => (
                <div key={p.tanggal} className="group relative flex-1">
                  <div
                    title={`${p.tanggal}: ${formatRupiah(p.omzet)} · ${p.pesanan} pesanan`}
                    style={{ height: `${Math.max(4, (p.omzet / maxOmzet) * 136)}px` }}
                    className={`w-full rounded-t-md transition ${i === 13 ? "bg-pink-500" : i >= 7 ? "bg-pink-300" : "bg-gray-200 group-hover:bg-gray-300"}`}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1.5">
              {tren.map((p) => (
                <span key={p.tanggal} className="flex-1 text-center text-[10px] text-gray-400">
                  {DAY_SHORT[new Date(`${p.tanggal}T00:00:00`).getDay()]}
                </span>
              ))}
            </div>
            {minggu && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-sm text-gray-600">
                Minggu berjalan <strong className="text-gray-900">{formatRupiah(minggu.ini)}</strong>
                <Delta now={minggu.ini} before={minggu.lalu} label="vs 7 hari sebelumnya" />
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Keputusan · Produk · Stok */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Perlu Keputusan" failed={failed.has("overview:perluKeputusan")}>
          {keputusan && (
            <ul className="divide-y divide-gray-100">
              {(
                [
                  { t: "Pengajuan cuti", n: keputusan.cuti, href: "/dashboard/hris/leaves" },
                  { t: "Pengajuan lembur", n: keputusan.lembur, href: "/dashboard/hris/overtime" },
                  { t: "Pengajuan pinjaman", n: keputusan.pinjaman, href: "/dashboard/hris/loans" },
                  { t: "PO draft", n: keputusan.poDraft, href: "/dashboard/purchasing/approval" },
                  { t: "Kandidat baru", n: keputusan.kandidatBaru, href: "/dashboard/hris/candidates" },
                ] as const
              ).map((r) => (
                <li key={r.t}>
                  <Link href={r.href} className="flex items-center justify-between py-2 text-sm text-gray-700 hover:text-pink-600">
                    {r.t}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.n > 0 ? "bg-pink-100 text-pink-700" : "bg-gray-100 text-gray-400"}`}
                    >
                      {r.n}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Produk Terlaris · 7 Hari" href="/dashboard/pos" failed={failed.has("topProduk")}>
          {data.topProduk7Hari &&
            (data.topProduk7Hari.length === 0 ? (
              <p className="text-sm text-gray-400">Belum ada penjualan 7 hari terakhir.</p>
            ) : (
              <ul className="space-y-2.5">
                {data.topProduk7Hari.map((p, i) => (
                  <li key={p.produk} className="flex items-center gap-3 text-sm">
                    <span className="w-4 shrink-0 text-xs font-bold text-gray-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-800">{p.produk}</span>
                    <span className="shrink-0 text-xs text-gray-400">{p.qty}×</span>
                    <span className="shrink-0 font-semibold text-gray-900">{formatRupiah(p.omzet)}</span>
                  </li>
                ))}
              </ul>
            ))}
        </SectionCard>

        <SectionCard title="Inventori" href="/dashboard/inventory/low-stock" hrefLabel="Stok menipis" failed={failed.has("nilaiPersediaan") && failed.has("overview:stokMenipis")}>
          <div className="space-y-3">
            {data.nilaiPersediaan !== null && (
              <div>
                <div className="text-xs text-gray-500">Nilai persediaan saat ini</div>
                <div className="text-xl font-extrabold text-gray-900">{formatRupiah(data.nilaiPersediaan)}</div>
              </div>
            )}
            {o.stokMenipis && (
              <div className={`rounded-lg px-3 py-2 text-sm ${o.stokMenipis.jumlah > 0 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                {o.stokMenipis.jumlah > 0
                  ? `${o.stokMenipis.jumlah} bahan di bawah minimum`
                  : "Semua stok di atas batas minimum"}
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {/* Purchasing · Payroll & SDM · Member */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Purchasing Bulan Ini" href="/dashboard/purchasing" failed={failed.has("purchasing")}>
          {data.purchasingBulanIni && (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-extrabold text-gray-900">{data.purchasingBulanIni.jumlahPo} PO</span>
                <span className="text-sm text-gray-500">{formatRupiah(data.purchasingBulanIni.nilaiTotal)}</span>
              </div>
              {data.purchasingBulanIni.perStatus.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {data.purchasingBulanIni.perStatus.map((s) => (
                    <span key={s.status} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                      {s.status}: <strong>{s.jumlah}</strong>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard title="Payroll & SDM" href="/dashboard/hris/payroll" failed={failed.has("payroll")}>
          <div className="space-y-2.5 text-sm">
            {data.payrollTerakhir ? (
              <div>
                <div className="text-xs text-gray-500">Run terakhir · {data.payrollTerakhir.periode}</div>
                <div className="font-semibold text-gray-900">
                  {formatRupiah(data.payrollTerakhir.totalNet)}{" "}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {data.payrollTerakhir.status}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-gray-400">Belum ada payroll run.</p>
            )}
            {data.kontrakHabis30Hari !== null && (
              <Link
                href="/dashboard/hris/contracts"
                className={`block rounded-lg px-3 py-2 text-sm ${data.kontrakHabis30Hari > 0 ? "bg-amber-50 text-amber-700 hover:bg-amber-100" : "bg-gray-50 text-gray-500"}`}
              >
                {data.kontrakHabis30Hari > 0
                  ? `${data.kontrakHabis30Hari} kontrak berakhir ≤ 30 hari`
                  : "Tidak ada kontrak berakhir dalam 30 hari"}
              </Link>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Member & Loyalty · 7 Hari" href="/dashboard/crm/members" failed={failed.has("overview:member")}>
          {o.member && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <div className="text-lg font-extrabold text-gray-900">{o.member.memberBaru7Hari}</div>
                <div className="text-[11px] text-gray-500">Member baru</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <div className="text-lg font-extrabold text-gray-900">
                  {o.member.xpTerdistribusi7Hari.toLocaleString("id-ID")}
                </div>
                <div className="text-[11px] text-gray-500">XP keluar</div>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <div className="text-lg font-extrabold text-gray-900">{o.member.rewardDitukar7Hari}</div>
                <div className="text-[11px] text-gray-500">Reward ditukar</div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
