"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineStage } from "@/types";
import { buildWaLink } from "@/lib/recruitment/wa";
import { useCandidateScreening } from "../queries";
import { useSaveCandidateScreening, useLogWaTemplate } from "../mutations";
import type { ScreeningPayload, ScreeningRecommendation, WaTemplateKey } from "../api";

/** Field minimal yang dibutuhkan panel — kompatibel dgn Candidate & CandidateView. */
export interface ScreeningPanelCandidate {
  id: string;
  full_name: string;
  phone?: string | null;
  expected_salary?: number | null;
  positions?: { title: string } | null;
}

/**
 * Action panel untuk stage Screening:
 * 1. Checklist otomatis (derived dari isi form, selalu akurat)
 * 2. Form hasil screening call: kontak, minat & ketersediaan, konfirmasi gaji
 *    (warning selisih >20% vs ekspektasi awal), shift/penempatan, catatan,
 *    rekomendasi Lolos/Hold/Tidak Lolos
 * 3. Template WA (undangan screening, lolos→psikotes, penolakan halus)
 * 4. Keputusan: Lolos → Psikotes (aktif hanya setelah rekomendasi tersimpan)
 *
 * State form = serverDraft (dari query) + override (edit user). Render panel
 * dengan `key={candidate.id}` supaya override ikut reset saat ganti kandidat.
 */

const EMPTY_DRAFT: ScreeningPayload = {
  contacted: false,
  interested: null,
  availability_note: null,
  confirmed_salary: null,
  willing_shift: null,
  willing_placement: null,
  notes: null,
  recommendation: null,
};

const SALARY_GAP_THRESHOLD = 0.2;
// selaras dgn screeningSchema (max 1e12): 12 digit = 999.999.999.999
const SALARY_MAX_DIGITS = 12;

const WA_TEMPLATES: { key: WaTemplateKey; label: string; build: (nama: string, posisi: string) => string }[] = [
  {
    key: "undangan_screening",
    label: "Undangan Screening",
    build: (nama, posisi) =>
      `Halo ${nama}, terima kasih telah melamar posisi ${posisi} di perusahaan kami. ` +
      `Kami ingin mengundang Anda untuk sesi screening call singkat mengenai lamaran Anda. ` +
      `Mohon informasikan waktu yang nyaman untuk kami hubungi. Terima kasih.`,
  },
  {
    key: "lolos_psikotes",
    label: "Lolos → Psikotes",
    build: (nama, posisi) =>
      `Halo ${nama}, selamat! Anda dinyatakan lolos tahap screening untuk posisi ${posisi}. ` +
      `Tahap selanjutnya adalah psikotes — jadwal dan detailnya akan kami informasikan segera. ` +
      `Terima kasih.`,
  },
  {
    key: "penolakan",
    label: "Penolakan Halus",
    build: (nama, posisi) =>
      `Halo ${nama}, terima kasih atas waktu dan minat Anda pada posisi ${posisi}. ` +
      `Setelah pertimbangan, saat ini kami belum dapat melanjutkan proses Anda ke tahap berikutnya. ` +
      `Data Anda tetap kami simpan untuk peluang yang sesuai di masa mendatang. Semoga sukses selalu.`,
  },
];

const RECOMMENDATION_OPTIONS: {
  value: ScreeningRecommendation;
  label: string;
  activeClass: string;
}[] = [
  { value: "lolos", label: "Lolos", activeClass: "bg-emerald-600 text-white border-emerald-600" },
  { value: "hold", label: "Hold", activeClass: "bg-amber-500 text-white border-amber-500" },
  { value: "tidak_lolos", label: "Tidak Lolos", activeClass: "bg-red-600 text-white border-red-600" },
];

function formatRupiah(value: number) {
  return `Rp ${new Intl.NumberFormat("id-ID").format(value)}`;
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <Circle className="size-4 shrink-0 text-gray-300" />
      )}
      <span className={done ? "text-gray-800" : "text-gray-400"}>{label}</span>
    </div>
  );
}

/** Toggle 3-keadaan: null (belum ditanya) / true (Ya) / false (Tidak). */
function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="flex gap-1.5">
        {[
          { v: true, text: "Ya", active: "bg-emerald-600 text-white border-emerald-600" },
          { v: false, text: "Tidak", active: "bg-red-600 text-white border-red-600" },
        ].map((opt) => (
          <button
            key={opt.text}
            type="button"
            onClick={() => onChange(value === opt.v ? null : opt.v)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              value === opt.v
                ? opt.active
                : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
            }`}
          >
            {opt.text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ScreeningActionPanel({
  candidate,
  onMove,
  moving = false,
}: {
  candidate: ScreeningPanelCandidate;
  onMove: (stage: PipelineStage) => void;
  moving?: boolean;
}) {
  const screeningQuery = useCandidateScreening(candidate.id);
  const saveScreening = useSaveCandidateScreening();
  const logWa = useLogWaTemplate();

  // edit user di atas nilai server; {} = belum ada edit
  const [override, setOverride] = useState<Partial<ScreeningPayload>>({});

  const saved = screeningQuery.data ?? null;
  const serverDraft = useMemo<ScreeningPayload>(
    () =>
      saved
        ? {
            contacted: saved.contacted,
            interested: saved.interested,
            availability_note: saved.availability_note,
            confirmed_salary: saved.confirmed_salary,
            willing_shift: saved.willing_shift,
            willing_placement: saved.willing_placement,
            notes: saved.notes,
            recommendation: saved.recommendation,
          }
        : EMPTY_DRAFT,
    [saved]
  );
  const draft: ScreeningPayload = { ...serverDraft, ...override };
  const patch = (p: Partial<ScreeningPayload>) => setOverride((o) => ({ ...o, ...p }));

  const salaryText =
    draft.confirmed_salary != null
      ? new Intl.NumberFormat("id-ID").format(draft.confirmed_salary)
      : "";
  const handleSalaryChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, SALARY_MAX_DIGITS);
    patch({ confirmed_salary: digits ? Number(digits) : null });
  };

  const expected = candidate.expected_salary ?? null;
  const confirmed = draft.confirmed_salary;
  const salaryGap =
    expected && expected > 0 && confirmed != null
      ? (confirmed - expected) / expected
      : null;

  const checklist = [
    { label: "Kandidat dihubungi (screening call)", done: draft.contacted },
    {
      label: "Minat & ketersediaan dikonfirmasi",
      done: draft.interested !== null && Boolean(draft.availability_note?.trim()),
    },
    { label: "Gaji dikonfirmasi", done: draft.confirmed_salary != null },
    {
      label: "Kesediaan shift & penempatan",
      done: draft.willing_shift !== null && draft.willing_placement !== null,
    },
    { label: "Rekomendasi terisi", done: draft.recommendation !== null },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const normalizedDraft: ScreeningPayload = {
    ...draft,
    availability_note: draft.availability_note?.trim() || null,
    notes: draft.notes?.trim() || null,
  };
  const draftDirty = JSON.stringify(normalizedDraft) !== JSON.stringify(serverDraft);

  const handleSave = () => {
    saveScreening.mutate(
      { id: candidate.id, payload: normalizedDraft },
      // cache sudah diisi baris server oleh mutation; override tak dibutuhkan lagi
      { onSuccess: () => setOverride({}) }
    );
  };

  const positionTitle = candidate.positions?.title ?? "posisi yang dilamar";

  const handleWaTemplate = (template: (typeof WA_TEMPLATES)[number]) => {
    const link = buildWaLink(candidate.phone, template.build(candidate.full_name, positionTitle));
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate(
      { id: candidate.id, template: template.key },
      {
        onError: () =>
          toast.error("WhatsApp terbuka, tapi aktivitas gagal tercatat di timeline"),
      }
    );
  };

  const recommendationSaved = saved?.recommendation != null;

  if (screeningQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 p-4 text-sm text-gray-400">
        <Loader2 className="size-4 animate-spin" /> Memuat hasil screening…
      </div>
    );
  }

  // jangan render form saat fetch gagal — draft kosong bisa menimpa data tersimpan
  if (screeningQuery.isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
        <p className="text-sm text-red-700">
          Gagal memuat hasil screening —{" "}
          {screeningQuery.error instanceof Error
            ? screeningQuery.error.message
            : "terjadi kesalahan"}
        </p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => screeningQuery.refetch()}>
          <RefreshCw className="size-3.5" /> Coba Lagi
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Checklist ── */}
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-800">Checklist Screening</h4>
          <span className="text-xs font-medium text-gray-500">
            {doneCount}/{checklist.length}
          </span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-cyan-500 transition-all"
            style={{ width: `${(doneCount / checklist.length) * 100}%` }}
          />
        </div>
        <div className="space-y-2">
          {checklist.map((c) => (
            <ChecklistItem key={c.label} done={c.done} label={c.label} />
          ))}
        </div>
      </div>

      {/* ── Form hasil screening call ── */}
      <div className="rounded-xl border border-gray-200 p-4">
        <h4 className="mb-4 text-sm font-semibold text-gray-800">Hasil Screening Call</h4>

        <div className="space-y-4">
          {/* kontak */}
          <button
            type="button"
            onClick={() => patch({ contacted: !draft.contacted })}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              draft.contacted
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {draft.contacted ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
            ) : (
              <Circle className="size-4 shrink-0 text-gray-300" />
            )}
            Kandidat sudah dihubungi (screening call)
          </button>

          {/* minat & ketersediaan */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TriToggle
              label="Masih berminat?"
              value={draft.interested}
              onChange={(v) => patch({ interested: v })}
            />
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">
                Ketersediaan mulai kerja
              </div>
              <Input
                value={draft.availability_note ?? ""}
                onChange={(e) => patch({ availability_note: e.target.value || null })}
                placeholder="Contoh: 2 minggu lagi / awal Agustus"
                maxLength={200}
                className="text-sm"
              />
            </div>
          </div>

          {/* konfirmasi gaji */}
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">
              Konfirmasi Gaji
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">
                Rp
              </span>
              <Input
                value={salaryText}
                onChange={(e) => handleSalaryChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                className="pl-9 text-sm"
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-gray-400">
                Ekspektasi awal: {expected ? formatRupiah(expected) : "—"}
              </span>
              {salaryGap !== null && Math.abs(salaryGap) > SALARY_GAP_THRESHOLD && (
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                  <TriangleAlert className="size-3" />
                  Selisih {salaryGap > 0 ? "+" : "−"}
                  {Math.round(Math.abs(salaryGap) * 100)}% dari ekspektasi awal
                </span>
              )}
            </div>
          </div>

          {/* shift & penempatan */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TriToggle
              label="Bersedia kerja shift?"
              value={draft.willing_shift}
              onChange={(v) => patch({ willing_shift: v })}
            />
            <TriToggle
              label="Bersedia ditempatkan di outlet mana pun?"
              value={draft.willing_placement}
              onChange={(v) => patch({ willing_placement: v })}
            />
          </div>

          {/* catatan */}
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">
              Catatan Screening
            </div>
            <Textarea
              value={draft.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value || null })}
              placeholder="Hasil percakapan, kesan, hal yang perlu ditindaklanjuti…"
              rows={3}
              maxLength={2000}
              className="text-sm"
            />
          </div>

          {/* rekomendasi */}
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">
              Rekomendasi
            </div>
            <div className="flex flex-wrap gap-2">
              {RECOMMENDATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    patch({
                      recommendation: draft.recommendation === opt.value ? null : opt.value,
                    })
                  }
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                    draft.recommendation === opt.value
                      ? opt.activeClass
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {saveScreening.isError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {saveScreening.error instanceof Error
              ? saveScreening.error.message
              : "Gagal menyimpan hasil screening"}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
          <Button size="sm" onClick={handleSave} disabled={saveScreening.isPending || !draftDirty}>
            {saveScreening.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Simpan Hasil Screening
          </Button>
          {saved && (
            <span className="text-xs text-gray-400">
              Terakhir disimpan {saved.updated_by_name || "HR"} ·{" "}
              {new Date(saved.updated_at).toLocaleString("id-ID", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      {/* ── Template WA ── */}
      <div className="rounded-xl border border-gray-200 p-4">
        <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <MessageCircle className="size-4 text-emerald-500" /> Template WhatsApp
        </h4>
        <p className="mb-3 text-xs text-gray-400">
          Membuka WhatsApp dengan pesan terisi (nama & posisi) — pembukaan tercatat di
          timeline Aktivitas.
        </p>
        {!candidate.phone && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Nomor HP kandidat belum diisi — template tidak bisa dikirim.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {WA_TEMPLATES.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant="outline"
              disabled={!candidate.phone || logWa.isPending}
              onClick={() => handleWaTemplate(t)}
            >
              <MessageCircle className="size-3.5 text-emerald-500" /> {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* ── Keputusan ── */}
      <div className="rounded-xl border border-gray-200 p-4">
        <h4 className="mb-3 text-sm font-semibold text-gray-800">Keputusan</h4>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={moving || !recommendationSaved}
            onClick={() => onMove("psikotes")}
          >
            Lolos → Psikotes <ArrowRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-pink-600 hover:bg-pink-50"
            disabled={moving}
            onClick={() => onMove("talent_pool")}
          >
            Simpan ke Talent Pool
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 hover:bg-red-50"
            disabled={moving}
            onClick={() => onMove("rejected")}
          >
            Tolak
          </Button>
        </div>
        {!recommendationSaved && (
          <p className="mt-2 text-xs text-gray-400">
            Isi & simpan rekomendasi terlebih dahulu untuk mengaktifkan tombol
            &quot;Lolos → Psikotes&quot;.
          </p>
        )}
      </div>
    </div>
  );
}
