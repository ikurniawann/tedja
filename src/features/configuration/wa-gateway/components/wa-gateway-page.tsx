"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  History,
  CheckCircle2,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { WaMessageHistory } from "./wa-message-history";

/**
 * Settings → WhatsApp Gateway — status koneksi + QR pairing.
 *
 * QR pairing berganti ±20 detik di sisi WhatsApp, jadi halaman ini menyegarkan
 * diri tiap beberapa detik selama belum terhubung. Setelah terhubung, polling
 * melambat — cukup untuk memantau kesehatan koneksi.
 */

interface GatewayState {
  configured: boolean;
  reachable?: boolean;
  status: {
    connected: boolean;
    phone: string | null;
    needsPairing: boolean;
    lastConnectedAt: string | null;
    lastDisconnectReason: string | null;
  } | null;
  qr: string | null;
}

const POLL_PAIRING_MS = 4000;
const POLL_CONNECTED_MS = 30000;

const tanggal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : "-";

export function WaGatewayPage() {
  const [tab, setTab] = useState<"status" | "history">("status");
  const [state, setState] = useState<GatewayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/wa-gateway", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || "Gagal memuat status gateway");
      }
      setState(json.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat status gateway");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Jadwalkan poll berikutnya berdasarkan kondisi terakhir.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const connected = state?.status?.connected ?? false;
    timerRef.current = setTimeout(
      () => void load(),
      connected ? POLL_CONNECTED_MS : POLL_PAIRING_MS
    );
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state, load]);

  const status = state?.status ?? null;
  const connected = status?.connected ?? false;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div className="border-b border-slate-200 pb-4">
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="size-4" />
            Settings
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-slate-950">
            <MessageCircle className="size-6 text-emerald-600" />
            WhatsApp Gateway
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Koneksi nomor pengirim OTP portal member ({""}
            <span className="font-medium">+62 858-8097-4659</span>). Pindai QR di bawah
            dari HP nomor tersebut untuk menautkan.
          </p>
        </div>

        <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
          {(
            [
              ["status", "Status & Pairing", Smartphone],
              ["history", "Riwayat Pesan", History],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                tab === value ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "history" ? (
          <WaMessageHistory />
        ) : (
          <>
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-8 animate-spin text-slate-400" />
          </div>
        ) : !state?.configured ? (
          <StatusCard
            icon={ShieldAlert}
            tone="amber"
            title="Gateway belum dikonfigurasi"
            description="WA_GATEWAY_TOKEN belum diisi di environment aplikasi. Lihat docs/crm/RUNBOOK-WA-GATEWAY-MANDIRI.md."
          />
        ) : state.reachable === false ? (
          <StatusCard
            icon={WifiOff}
            tone="red"
            title="Gateway tidak merespons"
            description="Proses wa-gateway kemungkinan mati. Jalankan: pm2 restart wa-gateway, lalu muat ulang halaman ini."
          />
        ) : connected ? (
          <StatusCard
            icon={CheckCircle2}
            tone="emerald"
            title={`Terhubung sebagai +${status?.phone ?? "?"}`}
            description={`Terakhir tersambung ${tanggal(status?.lastConnectedAt ?? null)}. OTP portal member dikirim lewat nomor ini.`}
          />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <Smartphone className="mt-0.5 size-5 shrink-0 text-slate-500" />
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Menunggu pairing
                </h2>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-slate-600">
                  <li>Buka WhatsApp di HP nomor <strong>+62 858-8097-4659</strong></li>
                  <li>Setelan → <strong>Perangkat Tertaut</strong> → <strong>Tautkan Perangkat</strong></li>
                  <li>Pindai QR di bawah</li>
                </ol>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              {state.qr ? (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <QRCodeSVG value={state.qr} size={264} marginSize={1} />
                  </div>
                  <p className="text-xs text-slate-400">
                    QR berganti otomatis setiap ±20 detik — halaman ini ikut menyegarkan
                    sendiri.
                  </p>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 className="size-6 animate-spin" />
                  Menyiapkan QR dari gateway...
                </div>
              )}
            </div>

            {status?.lastDisconnectReason && (
              <p className="mt-4 text-center text-xs text-slate-400">
                Terakhir terputus: alasan {status.lastDisconnectReason}
                {status.lastConnectedAt && ` · tersambung terakhir ${tanggal(status.lastConnectedAt)}`}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            <RefreshCw className="size-4" />
            Muat ulang
          </button>
        </div>

        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
          <strong className="text-slate-700">Catatan keamanan:</strong> QR di halaman ini
          adalah kredensial sesi WhatsApp — siapa pun yang memindainya menautkan nomor
          bisnis ke perangkatnya. Halaman ini hanya bisa dibuka Super Admin; jangan
          membagikan tangkapan layarnya.
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  tone,
  title,
  description,
}: {
  icon: typeof CheckCircle2;
  tone: "emerald" | "amber" | "red";
  title: string;
  description: string;
}) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
  };
  const iconTones = {
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
  };

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-5 py-4 ${tones[tone]}`}>
      <Icon className={`mt-0.5 size-6 shrink-0 ${iconTones[tone]}`} />
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm opacity-80">{description}</p>
      </div>
    </div>
  );
}
