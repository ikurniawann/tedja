"use client";

import { useEffect, useState } from "react";
import {
  normalizeWaRecipient,
  type WaNotifConfig,
  type WaNotifType,
  type WaNotifTypeMeta,
} from "@/lib/wa/notifications-config";

/**
 * Panel konfigurasi notifikasi WA owner (EPIC-020) — dirender di dalam
 * WindowShell desktop (Settings → Notifikasi WA). Mengatur: saklar utama,
 * jenis notifikasi mana yang aktif, nomor penerima, dan ambang void.
 */

const TIER_LABELS: Record<WaNotifTypeMeta["tier"], { title: string; note: string }> = {
  kritis: { title: "Kritis", note: "Dikirim seketika, kapan pun terjadi" },
  harian: { title: "Ringkasan Harian", note: "Satu pesan di jam tutup" },
  ambang: { title: "Ambang & Pengingat", note: "Hanya saat melewati batas" },
};

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? "bg-gradient-to-r from-pink-500 to-rose-600" : "bg-white/16"}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

export function WaNotifSettingsPanel() {
  const [config, setConfig] = useState<WaNotifConfig | null>(null);
  const [catalog, setCatalog] = useState<WaNotifTypeMeta[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/wa-notifications");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Gagal memuat");
        if (!cancelled) {
          setConfig(json.data.config);
          setCatalog(json.data.catalog);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Gagal memuat");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) return <div className="p-5 text-sm text-rose-300">{loadError}</div>;
  if (!config) {
    return (
      <div className="space-y-3 p-5">
        <div className="h-10 animate-pulse rounded-2xl bg-white/10" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/8" />
        <div className="h-24 animate-pulse rounded-2xl bg-white/8" />
      </div>
    );
  }

  const setType = (key: WaNotifType, value: boolean) =>
    setConfig((prev) => (prev ? { ...prev, types: { ...prev.types, [key]: value } } : prev));

  const addPhone = () => {
    const normalized = normalizeWaRecipient(phoneInput);
    if (!normalized) {
      setPhoneError("Nomor tidak valid — pakai format 08… atau 62…");
      return;
    }
    if (config.recipients.includes(normalized)) {
      setPhoneError("Nomor sudah terdaftar");
      return;
    }
    if (config.recipients.length >= 5) {
      setPhoneError("Maksimal 5 nomor");
      return;
    }
    setConfig({ ...config, recipients: [...config.recipients, normalized] });
    setPhoneInput("");
    setPhoneError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/wa-notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal menyimpan");
      setConfig(json.data.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/wa-notifications/test", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Gagal mengirim tes");
      const results = json.data.results as Array<{ target: string; success: boolean; reason: string | null }>;
      setTestResult(
        results
          .map((r) => `${r.target}: ${r.success ? "terkirim ✓" : `gagal — ${r.reason ?? "?"}`}`)
          .join("\n")
      );
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : "Gagal mengirim tes");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 p-5 text-white">
      {/* saklar utama */}
      <div className="flex items-center gap-3 rounded-3xl border border-white/14 bg-slate-950/55 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Notifikasi WhatsApp</div>
          <div className="text-xs leading-5 text-white/45">
            Kabar penting bisnis dikirim otomatis ke nomor di bawah — tanpa perlu membuka desktop.
          </div>
        </div>
        <Toggle on={config.enabled} onChange={(v) => setConfig({ ...config, enabled: v })} label="Aktifkan notifikasi WA" />
      </div>

      {/* nomor penerima */}
      <div className="rounded-3xl border border-white/14 bg-slate-950/55 p-4">
        <div className="text-sm font-semibold">Nomor Penerima</div>
        <div className="mt-1 text-xs text-white/45">Maksimal 5 nomor. Format 08… atau 62…</div>
        {config.recipients.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {config.recipients.map((r) => (
              <span key={r} className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-slate-950/55 px-3 py-1 text-xs">
                {r}
                <button
                  type="button"
                  aria-label={`Hapus ${r}`}
                  onClick={() => setConfig({ ...config, recipients: config.recipients.filter((x) => x !== r) })}
                  className="text-white/45 transition hover:text-rose-300"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={phoneInput}
            onChange={(e) => {
              setPhoneInput(e.target.value);
              setPhoneError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPhone();
              }
            }}
            placeholder="08xxxxxxxxxx"
            inputMode="tel"
            className="arkiv-glass-input min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addPhone}
            className="shrink-0 rounded-xl bg-white/12 px-4 py-2 text-sm font-semibold transition hover:bg-white/18"
          >
            Tambah
          </button>
        </div>
        {phoneError && <p className="mt-2 text-xs text-rose-300">{phoneError}</p>}
      </div>

      {/* jenis notifikasi per tingkat */}
      {(["kritis", "harian", "ambang"] as const).map((tier) => (
        <div key={tier} className="rounded-3xl border border-white/14 bg-slate-950/55 p-4">
          <div className="text-sm font-semibold">{TIER_LABELS[tier].title}</div>
          <div className="text-xs text-white/40">{TIER_LABELS[tier].note}</div>
          <div className="mt-3 space-y-3">
            {catalog
              .filter((t) => t.tier === tier)
              .map((t) => (
                <div key={t.key} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{t.label}</div>
                    <div className="text-xs leading-5 text-white/40">{t.description}</div>
                    {t.key === "voidBesar" && config.types.voidBesar && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-white/55">
                        Ambang: Rp
                        <input
                          value={config.voidThresholdRp.toLocaleString("id-ID")}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/\D/g, ""));
                            setConfig({ ...config, voidThresholdRp: Number.isFinite(n) ? n : 0 });
                          }}
                          inputMode="numeric"
                          className="arkiv-glass-input w-28 rounded-lg border px-2 py-1 text-xs"
                        />
                      </div>
                    )}
                  </div>
                  <Toggle on={config.types[t.key]} onChange={(v) => setType(t.key, v)} label={t.label} />
                </div>
              ))}
          </div>
        </div>
      ))}

      {/* aksi */}
      {saveError && <p className="text-sm text-rose-300">{saveError}</p>}
      {testResult && (
        <pre className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/25 p-3 text-xs text-white/70">{testResult}</pre>
      )}
      <div className="flex flex-wrap items-center gap-3 pb-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-pink-500 to-rose-600 px-5 py-2 text-sm font-semibold shadow-lg transition hover:from-pink-400 hover:to-rose-500 disabled:opacity-50"
        >
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={sendTest}
          disabled={testing || config.recipients.length === 0}
          title={config.recipients.length === 0 ? "Tambahkan dan simpan nomor dulu" : "Kirim pesan uji ke semua nomor tersimpan"}
          className="rounded-xl border border-white/16 bg-white/10 px-5 py-2 text-sm font-semibold transition hover:bg-white/16 disabled:opacity-50"
        >
          {testing ? "Mengirim…" : "Kirim Tes"}
        </button>
        {saved && <span className="text-sm text-emerald-300">Tersimpan ✓</span>}
        <span className="ml-auto text-[11px] text-white/35">Kirim Tes memakai nomor yang TERSIMPAN, bukan yang belum di-Simpan.</span>
      </div>
    </div>
  );
}
