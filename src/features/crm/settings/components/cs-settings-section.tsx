"use client";

import { useEffect, useState } from "react";
import { Clock, Headset, Loader2, MessageSquareReply, Save, Star, Timer } from "lucide-react";
import type { CrmSettings } from "../types";

/**
 * EPIC-012 Fase D/E — konfigurasi customer service oleh Super Admin:
 * SLA, jam operasional chat, auto-reply, dan permintaan rating.
 */

type Draft = {
  cs_sla_response_minutes: string;
  cs_sla_resolution_minutes: string;
  cs_business_hours_start: string;
  cs_business_hours_end: string;
  cs_auto_reply_enabled: boolean;
  cs_auto_reply_text: string;
  cs_csat_enabled: boolean;
  cs_csat_text: string;
};

function toDraft(settings: CrmSettings | undefined): Draft {
  return {
    cs_sla_response_minutes: String(settings?.cs_sla_response_minutes ?? 15),
    cs_sla_resolution_minutes: String(settings?.cs_sla_resolution_minutes ?? 1440),
    cs_business_hours_start: String(settings?.cs_business_hours_start ?? 10),
    cs_business_hours_end: String(settings?.cs_business_hours_end ?? 22),
    cs_auto_reply_enabled: settings?.cs_auto_reply_enabled ?? true,
    cs_auto_reply_text: settings?.cs_auto_reply_text ?? "",
    cs_csat_enabled: settings?.cs_csat_enabled ?? true,
    cs_csat_text: settings?.cs_csat_text ?? "",
  };
}

const jam = (value: string) => `${String(value).padStart(2, "0")}.00`;

export function CsSettingsSection({
  settings,
  loading,
  saving,
  onSave,
}: {
  settings: CrmSettings | undefined;
  loading: boolean;
  saving: boolean;
  onSave: (payload: Partial<CrmSettings>) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));

  // Sinkronkan saat data server datang/berubah — hindari form kosong sesaat.
  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  const start = Number(draft.cs_business_hours_start);
  const end = Number(draft.cs_business_hours_end);
  const buka24Jam = start === end;
  const lewatTengahMalam = start > end;

  function submit() {
    onSave({
      cs_sla_response_minutes: Math.max(1, Number(draft.cs_sla_response_minutes) || 15),
      cs_sla_resolution_minutes: Math.max(1, Number(draft.cs_sla_resolution_minutes) || 1440),
      cs_business_hours_start: Math.min(23, Math.max(0, Number(draft.cs_business_hours_start) || 0)),
      cs_business_hours_end: Math.min(23, Math.max(0, Number(draft.cs_business_hours_end) || 0)),
      cs_auto_reply_enabled: draft.cs_auto_reply_enabled,
      cs_auto_reply_text: draft.cs_auto_reply_text.trim() || undefined,
      cs_csat_enabled: draft.cs_csat_enabled,
      cs_csat_text: draft.cs_csat_text.trim() || undefined,
    });
  }

  const disabled = loading || saving;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <Headset className="size-4 text-slate-600" />
        <h2 className="text-base font-semibold text-slate-950">Customer Service (WhatsApp)</h2>
      </div>

      <div className="mt-4 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            icon={Timer}
            label="Batas balas pertama (menit)"
            hint="Percakapan yang belum dibalas melewati ini ditandai “Lewat SLA” di inbox."
          >
            <input
              type="number"
              min={1}
              max={1440}
              value={draft.cs_sla_response_minutes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cs_sla_response_minutes: event.target.value }))
              }
              disabled={disabled}
              className={inputClass}
            />
          </Field>

          <Field
            icon={Timer}
            label="Target penyelesaian (menit)"
            hint="Dipakai sebagai acuan di laporan. 1440 = 1 hari."
          >
            <input
              type="number"
              min={1}
              max={10080}
              value={draft.cs_sla_resolution_minutes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cs_sla_resolution_minutes: event.target.value }))
              }
              disabled={disabled}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <Clock className="size-3.5" /> Jam operasional chat
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-500">Mulai</span>
              <select
                value={draft.cs_business_hours_start}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cs_business_hours_start: event.target.value }))
                }
                disabled={disabled}
                className={`${inputClass} mt-1`}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>{jam(String(hour))}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-slate-500">Selesai</span>
              <select
                value={draft.cs_business_hours_end}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cs_business_hours_end: event.target.value }))
                }
                disabled={disabled}
                className={`${inputClass} mt-1`}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>{jam(String(hour))}</option>
                ))}
              </select>
            </label>
            <div className="pb-2 text-xs text-slate-500">
              {buka24Jam
                ? "Buka 24 jam — auto-reply tidak pernah aktif."
                : lewatTengahMalam
                  ? `Melewati tengah malam: ${jam(draft.cs_business_hours_start)}–${jam(draft.cs_business_hours_end)} WIB`
                  : `${jam(draft.cs_business_hours_start)}–${jam(draft.cs_business_hours_end)} WIB`}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Waktu mengikuti zona WIB. Jam selesai bersifat eksklusif — 22.00 berarti
            pesan pukul 22.00 sudah dianggap di luar jam operasional.
          </p>
        </div>

        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={draft.cs_auto_reply_enabled}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cs_auto_reply_enabled: event.target.checked }))
              }
              disabled={disabled}
              className="size-4 rounded border-slate-300"
            />
            <MessageSquareReply className="size-4 text-slate-500" />
            Balas otomatis di luar jam operasional
          </label>
          <textarea
            rows={3}
            value={draft.cs_auto_reply_text}
            onChange={(event) =>
              setDraft((current) => ({ ...current, cs_auto_reply_text: event.target.value }))
            }
            disabled={disabled || !draft.cs_auto_reply_enabled}
            className={`${inputClass} h-auto resize-y py-2`}
          />
          <p className="text-xs text-slate-400">
            Dikirim maksimal sekali per hari untuk tiap percakapan, agar tidak
            membanjiri customer.
          </p>
        </div>

        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={draft.cs_csat_enabled}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cs_csat_enabled: event.target.checked }))
              }
              disabled={disabled}
              className="size-4 rounded border-slate-300"
            />
            <Star className="size-4 text-slate-500" />
            Minta penilaian saat percakapan ditandai selesai
          </label>
          <textarea
            rows={2}
            value={draft.cs_csat_text}
            onChange={(event) =>
              setDraft((current) => ({ ...current, cs_csat_text: event.target.value }))
            }
            disabled={disabled || !draft.cs_csat_enabled}
            className={`${inputClass} h-auto resize-y py-2`}
          />
          <p className="text-xs text-slate-400">
            Customer membalas angka 1-5; skornya masuk ke laporan CS.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Simpan konfigurasi CS
          </button>
        </div>
      </div>
    </section>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-100 disabled:bg-slate-100";

function Field({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: typeof Timer;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Icon className="size-3.5" />
        {label}
      </span>
      <div className="mt-1">{children}</div>
      <span className="mt-1 block text-xs text-slate-400">{hint}</span>
    </label>
  );
}
