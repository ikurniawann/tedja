"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  MessageCircle,
  Plus,
  Save,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PipelineStage } from "@/types";
import { buildWaLink } from "@/lib/recruitment/wa";
import { scoreBadgeClass } from "@/lib/recruitment/psikotes";
import { useCandidatePsikotes } from "../queries";
import { useSavePsikotesSummary, useLogWaTemplate } from "../mutations";
import type { PsikotesRecommendation, PsikotesSession, PsikotesSessionTest } from "../api";
import { PsikotesSendDialog } from "./psikotes-send-dialog";
import { PsikotesTestDetailDialog } from "./psikotes-test-detail-dialog";
import { PsikotesProctorDialog } from "./psikotes-proctor-dialog";
import { PSIKOTES_TEST_STATUS, PSIKOTES_TERMINAL_STATUSES } from "./psikotes-status";

/** Field minimal yang dibutuhkan panel — kompatibel dgn Candidate & CandidateView. */
export interface PsikotesPanelCandidate {
  id: string;
  full_name: string;
  phone?: string | null;
  positions?: { title: string } | null;
}

const WA_TEMPLATES: {
  key: "lolos_interview" | "penolakan";
  label: string;
  build: (nama: string, posisi: string) => string;
}[] = [
  {
    key: "lolos_interview",
    label: "Lolos → Interview",
    build: (nama, posisi) =>
      `Halo ${nama}, selamat! Anda dinyatakan lolos tahap psikotes untuk posisi ${posisi}. ` +
      `Tahap selanjutnya adalah interview — jadwal dan detailnya akan kami informasikan segera. Terima kasih.`,
  },
  {
    key: "penolakan",
    label: "Penolakan Halus",
    build: (nama, posisi) =>
      `Halo ${nama}, terima kasih atas waktu dan partisipasi Anda dalam proses seleksi posisi ${posisi}. ` +
      `Setelah pertimbangan, saat ini kami belum dapat melanjutkan proses Anda ke tahap berikutnya. ` +
      `Data Anda tetap kami simpan untuk peluang yang sesuai di masa mendatang. Semoga sukses selalu.`,
  },
];

const RECOMMENDATION_OPTIONS: {
  value: PsikotesRecommendation;
  label: string;
  activeClass: string;
}[] = [
  { value: "lolos", label: "Lolos", activeClass: "bg-emerald-600 text-white border-emerald-600" },
  { value: "hold", label: "Hold", activeClass: "bg-amber-500 text-white border-amber-500" },
  { value: "tidak_lolos", label: "Tidak Lolos", activeClass: "bg-red-600 text-white border-red-600" },
];

const SESSION_STATUS_LABELS: Record<PsikotesSession["status"], string> = {
  draft: "Draft",
  sent: "Terkirim",
  in_progress: "Sedang dikerjakan",
  completed: "Selesai",
  expired: "Kedaluwarsa",
};

function ChecklistItem({ done, label, hint }: { done: boolean; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {done ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
      )}
      <div>
        <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function testResultSummary(test: PsikotesSessionTest): React.ReactNode {
  if (test.instrument_kind === "mcq" && test.status === "selesai") {
    return (
      <span className="flex items-baseline gap-2">
        <span className={`rounded-md px-2 py-0.5 text-lg font-bold ${scoreBadgeClass(test.score ?? 0)}`}>
          {test.score ?? 0}%
        </span>
        <span className="text-xs text-muted-foreground">
          {test.score_detail?.correct}/{test.score_detail?.total} benar
        </span>
      </span>
    );
  }
  if (test.instrument_kind === "forced_choice" && test.status === "selesai") {
    const dominant = test.score_detail?.dominant ?? [];
    return (
      <span className="text-sm font-semibold text-foreground">
        {dominant.length > 0
          ? dominant.map((d) => `${d.code} — ${d.label}`).join(" · ")
          : "Tidak ada jawaban"}
      </span>
    );
  }
  if (test.instrument_kind === "drawing") {
    if (test.status === "reviewed" && test.review_notes) {
      return <span className="line-clamp-2 text-sm text-muted-foreground">{test.review_notes}</span>;
    }
    if (test.status === "perlu_review") {
      return (
        <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
          Menunggu review manual HR
        </span>
      );
    }
  }
  return null;
}

/**
 * Action panel tahap Psikotes (EPIC-002 TG4):
 * 1. Checklist otomatis (undangan → hasil → proctoring → rekomendasi)
 * 2. Kirim/jadwalkan tes (link token + WA) & kartu hasil per instrumen
 * 3. Rekomendasi keseluruhan (gate keputusan) + template WA + keputusan
 * Render dgn `key={candidate.id}` supaya draft reset saat ganti kandidat.
 */
export function PsikotesActionPanel({
  candidate,
  onMove,
  moving = false,
}: {
  candidate: PsikotesPanelCandidate;
  onMove: (stage: PipelineStage) => void;
  moving?: boolean;
}) {
  const psikotesQuery = useCandidatePsikotes(candidate.id);
  const saveSummary = useSavePsikotesSummary();
  const logWa = useLogWaTemplate();

  const [sendOpen, setSendOpen] = useState(false);
  const [detailTest, setDetailTest] = useState<PsikotesSessionTest | null>(null);
  const [proctorSession, setProctorSession] = useState<PsikotesSession | null>(null);
  const [override, setOverride] = useState<{
    recommendation?: PsikotesRecommendation | null;
    notes?: string | null;
  }>({});

  const data = psikotesQuery.data ?? null;
  const summary = data?.summary ?? null;
  const sessions = useMemo(() => data?.sessions ?? [], [data]);

  const draft = {
    recommendation: override.recommendation !== undefined ? override.recommendation : (summary?.recommendation ?? null),
    notes: override.notes !== undefined ? override.notes : (summary?.notes ?? null),
  };
  const draftDirty =
    draft.recommendation !== (summary?.recommendation ?? null) ||
    (draft.notes?.trim() || null) !== (summary?.notes ?? null);
  const recommendationSaved = Boolean(summary?.recommendation);

  const stats = useMemo(() => {
    const allTests = sessions.flatMap((s) => s.tests);
    const doneTests = allTests.filter((t) => PSIKOTES_TERMINAL_STATUSES.includes(t.status));
    const flags = sessions.reduce((n, s) => n + s.proctor.flags, 0);
    const snapshots = sessions.reduce((n, s) => n + s.proctor.snapshots, 0);
    return { total: allTests.length, done: doneTests.length, flags, snapshots };
  }, [sessions]);

  const checklist = [
    {
      label: "Undangan tes dikirim",
      done: sessions.length > 0,
      hint: sessions.length > 0 ? `${sessions.length} undangan` : undefined,
    },
    {
      label: "Tes selesai & hasil tersedia",
      done: stats.total > 0 && stats.done === stats.total,
      hint: stats.total > 0 ? `${stats.done}/${stats.total} tes` : undefined,
    },
    {
      label: "Arsip bukti proctoring",
      done: stats.flags + stats.snapshots > 0,
      hint:
        stats.flags + stats.snapshots > 0
          ? `${stats.flags} flag · ${stats.snapshots} snapshot`
          : undefined,
    },
    { label: "Rekomendasi HR terisi", done: recommendationSaved },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const positionTitle = candidate.positions?.title ?? "posisi yang dilamar";

  const handleSaveSummary = () => {
    saveSummary.mutate(
      {
        id: candidate.id,
        payload: { recommendation: draft.recommendation, notes: draft.notes?.trim() || null },
      },
      {
        onSuccess: () => {
          setOverride({});
          toast.success("Rekomendasi psikotes tersimpan");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan"),
      }
    );
  };

  const handleWaTemplate = (template: (typeof WA_TEMPLATES)[number]) => {
    const link = buildWaLink(candidate.phone, template.build(candidate.full_name, positionTitle));
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate({ id: candidate.id, template: template.key });
  };

  const copySessionLink = async (session: PsikotesSession) => {
    if (!session.token) return;
    const link = `${window.location.origin}/psikotes/${session.token}`;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    toast.success("Link tes disalin");
  };

  if (psikotesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (psikotesQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border py-10">
        <p className="text-sm text-red-600 dark:text-red-400">
          {psikotesQuery.error instanceof Error
            ? psikotesQuery.error.message
            : "Gagal memuat data psikotes"}
        </p>
        <Button size="sm" variant="outline" onClick={() => psikotesQuery.refetch()}>
          Coba Lagi
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Checklist ── */}
      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <BrainCircuit className="size-4 text-violet-500" /> Psikotes Online
          </h3>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{checklist.length} langkah
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {checklist.map((item) => (
            <ChecklistItem key={item.label} done={item.done} label={item.label} hint={item.hint} />
          ))}
        </div>
      </div>

      {/* ── Hasil tes ── */}
      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Hasil Tes</h4>
          <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
            <Plus className="size-3.5" /> Kirim / jadwalkan tes
          </Button>
        </div>

        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Belum ada undangan tes. Kirim undangan untuk memulai psikotes online.
          </p>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => (
              <div key={session.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">
                    {SESSION_STATUS_LABELS[session.status]}
                  </span>
                  {session.invited_at && (
                    <span>
                      dikirim{" "}
                      {new Date(session.invited_at).toLocaleDateString("id-ID", {
                        day: "numeric",
                        month: "short",
                      })}
                      {session.created_by_name ? ` oleh ${session.created_by_name}` : ""}
                    </span>
                  )}
                  {(session.proctor.flags > 0 || session.proctor.snapshots > 0) && (
                    <button
                      type="button"
                      onClick={() => setProctorSession(session)}
                      className="inline-flex items-center gap-1 text-amber-600 hover:underline dark:text-amber-400"
                    >
                      <ShieldAlert className="size-3.5" />
                      {session.proctor.flags} flag · {session.proctor.snapshots} snapshot
                    </button>
                  )}
                  {session.token && (session.status === "sent" || session.status === "in_progress") && (
                    <button
                      type="button"
                      onClick={() => copySessionLink(session)}
                      className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <Copy className="size-3" /> salin link
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {session.tests.map((test) => {
                    const statusMeta = PSIKOTES_TEST_STATUS[test.status];
                    const summaryNode = testResultSummary(test);
                    const clickable = PSIKOTES_TERMINAL_STATUSES.includes(test.status);
                    return (
                      <div key={test.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {test.instrument_name}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.badge}`}
                          >
                            {statusMeta.label}
                          </span>
                        </div>
                        {summaryNode && <div className="mt-1.5">{summaryNode}</div>}
                        {clickable && (
                          <button
                            type="button"
                            onClick={() => setDetailTest(test)}
                            className="mt-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Lihat detail →
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Rekomendasi ── */}
      <div className="rounded-xl border border-border p-4">
        <h4 className="mb-1 text-sm font-semibold text-foreground">Rekomendasi Psikotes</h4>
        <p className="mb-3 text-xs text-muted-foreground">
          Kesimpulan keseluruhan hasil tes — menjadi syarat tombol &quot;Lolos → Interview&quot;.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {RECOMMENDATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                setOverride((o) => ({
                  ...o,
                  recommendation: draft.recommendation === opt.value ? null : opt.value,
                }))
              }
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                draft.recommendation === opt.value
                  ? opt.activeClass
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Textarea
          value={draft.notes ?? ""}
          onChange={(e) => setOverride((o) => ({ ...o, notes: e.target.value }))}
          rows={2}
          maxLength={2000}
          placeholder="Catatan interpretasi (mis. ringkasan PAPI & tes gambar)"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={handleSaveSummary} disabled={saveSummary.isPending || !draftDirty}>
            {saveSummary.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Simpan Rekomendasi
          </Button>
          {summary && (
            <span className="text-xs text-muted-foreground">
              Terakhir disimpan {summary.updated_by_name || "HR"} ·{" "}
              {new Date(summary.updated_at).toLocaleString("id-ID", {
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
      <div className="rounded-xl border border-border p-4">
        <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <MessageCircle className="size-4 text-emerald-500" /> Template WhatsApp
        </h4>
        <p className="mb-3 text-xs text-muted-foreground">
          Membuka WhatsApp dengan pesan terisi — pembukaan tercatat di timeline Aktivitas.
        </p>
        {!candidate.phone && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
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
      <div className="rounded-xl border border-border p-4">
        <h4 className="mb-3 text-sm font-semibold text-foreground">Keputusan</h4>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={moving || !recommendationSaved}
            onClick={() => onMove("interview")}
          >
            Lolos → Interview <ArrowRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-500/10"
            disabled={moving}
            onClick={() => onMove("talent_pool")}
          >
            Simpan ke Talent Pool
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            disabled={moving}
            onClick={() => onMove("rejected")}
          >
            Tolak
          </Button>
        </div>
        {!recommendationSaved && (
          <p className="mt-2 text-xs text-muted-foreground">
            Isi & simpan rekomendasi terlebih dahulu untuk mengaktifkan tombol
            &quot;Lolos → Interview&quot;.
          </p>
        )}
      </div>

      {sendOpen && (
        <PsikotesSendDialog
          candidate={candidate}
          positionTitle={positionTitle}
          open
          onOpenChange={setSendOpen}
        />
      )}
      {detailTest && (
        <PsikotesTestDetailDialog
          key={detailTest.id}
          test={detailTest}
          candidateId={candidate.id}
          open
          onOpenChange={(open) => {
            if (!open) setDetailTest(null);
          }}
        />
      )}
      {proctorSession && (
        <PsikotesProctorDialog
          key={proctorSession.id}
          session={proctorSession}
          open
          onOpenChange={(open) => {
            if (!open) setProctorSession(null);
          }}
        />
      )}
    </div>
  );
}
