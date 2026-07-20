"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Link2, Loader2, Save, ShieldAlert, Trash2 } from "lucide-react";

/**
 * EPIC-013 Fase A — form kredensial Google Business Profile.
 *
 * Rahasia (client secret & refresh token) tidak pernah dikirim balik dari
 * server; form hanya menampilkan penanda "tersimpan" + samaran. Mengosongkan
 * field rahasia berarti "biarkan yang lama", bukan menghapus.
 */

interface ConfigState {
  client_id: string;
  account_id: string;
  location_id: string;
  has_client_secret: boolean;
  client_secret_masked: string | null;
  has_refresh_token: boolean;
  refresh_token_masked: string | null;
  configured: boolean;
}

export function GoogleConnectPanel({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [form, setForm] = useState({
    client_id: "",
    client_secret: "",
    refresh_token: "",
    account_id: "",
    location_id: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ error: string | null; message: string | null }>({
    error: null,
    message: null,
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/google-business", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal memuat konfigurasi");
      setConfig(json.data);
      setForm((current) => ({
        ...current,
        client_id: json.data.client_id ?? "",
        account_id: json.data.account_id ?? "",
        location_id: json.data.location_id ?? "",
      }));
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal memuat konfigurasi",
        message: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setFeedback({ error: null, message: null });
    try {
      const response = await fetch("/api/settings/google-business", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "Gagal menyimpan");

      setForm((current) => ({ ...current, client_secret: "", refresh_token: "" }));
      setFeedback({ error: null, message: "Kredensial tersimpan." });
      await load();
      onSaved();
    } catch (error) {
      setFeedback({
        error: error instanceof Error ? error.message : "Gagal menyimpan",
        message: null,
      });
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    try {
      await fetch("/api/settings/google-business", { method: "DELETE" });
      setForm({ client_id: "", client_secret: "", refresh_token: "", account_id: "", location_id: "" });
      setFeedback({ error: null, message: "Kredensial dihapus." });
      await load();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center rounded-lg border border-slate-200 bg-white py-10 shadow-sm">
        <Loader2 className="size-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
          <Link2 className="size-4" />
          Koneksi Google Business Profile
        </h2>
        {config?.configured ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="size-3.5" /> Terhubung
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <ShieldAlert className="size-3.5" /> Belum lengkap
          </span>
        )}
      </div>

      {(feedback.error || feedback.message) && (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            feedback.error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {feedback.error || feedback.message}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field
          label="Client ID"
          value={form.client_id}
          onChange={(value) => setForm({ ...form, client_id: value })}
          placeholder="xxxxx.apps.googleusercontent.com"
        />
        <Field
          label="Client Secret"
          type="password"
          value={form.client_secret}
          onChange={(value) => setForm({ ...form, client_secret: value })}
          placeholder={config?.has_client_secret ? "Tersimpan — isi untuk mengganti" : "GOCSPX-..."}
          hint={config?.has_client_secret ? `Tersimpan: ${config.client_secret_masked}` : undefined}
        />
        <Field
          label="Refresh Token"
          type="password"
          value={form.refresh_token}
          onChange={(value) => setForm({ ...form, refresh_token: value })}
          placeholder={config?.has_refresh_token ? "Tersimpan — isi untuk mengganti" : "1//0g..."}
          hint={config?.has_refresh_token ? `Tersimpan: ${config.refresh_token_masked}` : undefined}
        />
        <div className="grid gap-3 sm:grid-cols-2 md:col-span-1">
          <Field
            label="Account ID"
            value={form.account_id}
            onChange={(value) => setForm({ ...form, account_id: value })}
            placeholder="accounts/123..."
          />
          <Field
            label="Location ID"
            value={form.location_id}
            onChange={(value) => setForm({ ...form, location_id: value })}
            placeholder="locations/987..."
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        Boleh diisi angka saja — awalan <code className="rounded bg-slate-100 px-1">accounts/</code>{" "}
        dan <code className="rounded bg-slate-100 px-1">locations/</code> ditambahkan otomatis.
        Akun yang dipakai harus punya akses pengelola pada lokasi. Langkah lengkap ada di{" "}
        <span className="font-mono">docs/crm/RUNBOOK-GOOGLE-REVIEW.md</span>.
      </p>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {config?.configured && (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={saving}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
          >
            <Trash2 className="size-4" /> Putuskan
          </button>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Simpan Kredensial
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100"
      />
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}
