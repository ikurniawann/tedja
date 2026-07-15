"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BotMessageSquare,
  CheckCircle2,
  Circle,
  Copy,
  Loader2,
  MessageCircle,
  Mic,
  Plus,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PipelineStage } from "@/types";
import { buildWaLink } from "@/lib/recruitment/wa";
import { scoreBadgeClass } from "@/lib/recruitment/psikotes";
import { useCandidateInterview, useInterviewRecordings } from "../queries";
import { useLogWaTemplate } from "../mutations";
import type { InterviewAiSession } from "../api";
import { InterviewSendDialog } from "./interview-send-dialog";
import { InterviewProctorDialog } from "./interview-proctor-dialog";

/** Field minimal yang dibutuhkan panel — kompatibel dgn Candidate & CandidateView. */
export interface InterviewPanelCandidate {
  id: string;
  full_name: string;
  phone?: string | null;
  positions?: { title: string } | null;
}

const SESSION_STATUS_LABELS: Record<InterviewAiSession["status"], string> = {
  sent: "Terkirim",
  in_progress: "Sedang berlangsung",
  completed: "Selesai",
  expired: "Kedaluwarsa",
};

const RELEVANSI_LABELS: Record<string, string> = {
  relevan: "Relevan",
  cukup_relevan: "Cukup Relevan",
  kurang_relevan: "Kurang Relevan",
};

const WA_TEMPLATES: {
  key: "lolos_offer" | "penolakan";
  label: string;
  build: (nama: string, posisi: string) => string;
}[] = [
  {
    key: "lolos_offer",
    label: "Lolos → Offer",
    build: (nama, posisi) =>
      `Halo ${nama}, selamat! Anda dinyatakan lolos tahap interview untuk posisi ${posisi}. ` +
      `Tahap selanjutnya adalah penawaran kerja — detailnya akan kami informasikan segera. Terima kasih.`,
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

/** Kartu kesimpulan AI satu sesi interview. */
function AiSummaryCard({ session }: { session: InterviewAiSession }) {
  const summary = session.ai_summary;
  if (!summary) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
        Interview selesai, tetapi kesimpulan AI gagal dibuat. Baca transkrip di bawah untuk menilai
        manual.
      </p>
    );
  }
  return (
    <div className="space-y-2.5 rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" />
        <span className="text-xs font-medium text-violet-900 dark:text-violet-200">
          Kesimpulan AI
        </span>
        <span
          title="Skor relevansi kandidat terhadap posisi (0–100)"
          className={`ml-auto rounded-md px-2 py-0.5 text-sm font-bold ${scoreBadgeClass(summary.relevansi.skor)}`}
        >
          {summary.relevansi.skor}
          <span className="text-[11px] font-medium opacity-70">/100</span>
        </span>
        <span className="text-xs font-semibold text-foreground">
          {RELEVANSI_LABELS[summary.relevansi.kesimpulan] ?? summary.relevansi.kesimpulan}
        </span>
      </div>
      <p className="text-sm text-foreground">{summary.ringkasan}</p>
      <p className="text-xs text-muted-foreground">{summary.relevansi.alasan}</p>
      {summary.keahlian.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {summary.keahlian.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
            >
              {skill}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-foreground">
        <span className="font-semibold">Ekspektasi gaji:</span>{" "}
        {summary.ekspektasi_gaji.disebutkan
          ? (summary.ekspektasi_gaji.nilai ?? "disebutkan")
          : "tidak disebutkan"}
        {summary.ekspektasi_gaji.catatan && (
          <span className="text-muted-foreground"> — {summary.ekspektasi_gaji.catatan}</span>
        )}
      </p>
      {summary.red_flags.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400">Red flags</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {summary.red_flags.map((flag, i) => (
              <li key={i} className="text-xs text-foreground">
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.perhatikan_saat_interview_lanjutan.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">
            Perhatikan saat interview lanjutan
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {summary.perhatikan_saat_interview_lanjutan.map((item, i) => (
              <li key={i} className="text-xs text-foreground">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="border-t border-border pt-2 text-[11px] italic text-muted-foreground">
        {summary.keterbatasan}
      </p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rekaman video penuh sesi interview — dimuat saat bagian dibuka. */
function RecordingsSection({ sessionId }: { sessionId: string }) {
  const [opened, setOpened] = useState(false);
  const recordings = useInterviewRecordings(opened ? sessionId : null);

  return (
    <details className="rounded-lg border border-border" onToggle={(e) => setOpened(e.currentTarget.open)}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground/80">
        Rekaman video interview
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        {recordings.isLoading ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Memuat rekaman…
          </p>
        ) : recordings.isError ? (
          <p className="text-xs text-red-600 dark:text-red-400">Gagal memuat rekaman.</p>
        ) : (recordings.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Belum ada rekaman video — rekaman tersedia utk sesi yang dikerjakan setelah fitur ini
            aktif.
          </p>
        ) : (
          (recordings.data ?? []).map((rec, i) => (
            <div key={rec.path} className="space-y-1">
              <p className="text-[11px] text-muted-foreground">
                Bagian {i + 1} · {formatBytes(rec.size)} ·{" "}
                {new Date(rec.modified_at).toLocaleString("id-ID", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <video
                controls
                preload="none"
                src={`/api/interview/files/${rec.path}`}
                className="aspect-video w-full rounded-lg border border-border bg-black"
              />
            </div>
          ))
        )}
      </div>
    </details>
  );
}

/** Transkrip tanya-jawab satu sesi (collapsible) + pemutar rekaman suara. */
function TranscriptSection({ session }: { session: InterviewAiSession }) {
  const answered = session.turns.filter((t) => t.answered_at);
  if (answered.length === 0) return null;
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground/80">
        Transkrip interview ({answered.length} tanya-jawab)
      </summary>
      <div className="max-h-96 space-y-3 overflow-y-auto border-t border-border p-3">
        {answered.map((turn) => (
          <div key={turn.id} className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              <span className="mr-1 text-xs text-muted-foreground">#{turn.turn_no}</span>
              {turn.question}
            </p>
            <p className="text-muted-foreground">{turn.answer_transcript || "(tidak menjawab)"}</p>
            {turn.answer_mode === "voice" && turn.answer_audio_path && (
              <audio
                controls
                preload="none"
                src={`/api/interview/files/${turn.answer_audio_path}`}
                className="h-8 w-full"
              />
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Action panel tahap Interview (EPIC-003):
 * 1. Checklist otomatis (undangan → interview selesai → kesimpulan AI)
 * 2. Kirim undangan interview AI (link token + WA) & hasil per sesi:
 *    kesimpulan AI (relevansi, keahlian, gaji) + transkrip + analitik
 *    proctoring (on-cam, keluar frame, buka tab).
 * 3. Template WA + keputusan (Lolos → Offer / Talent Pool / Tolak).
 */
export function InterviewActionPanel({
  candidate,
  onMove,
  moving = false,
}: {
  candidate: InterviewPanelCandidate;
  onMove: (stage: PipelineStage) => void;
  moving?: boolean;
}) {
  const interviewQuery = useCandidateInterview(candidate.id);
  const logWa = useLogWaTemplate();

  const [sendOpen, setSendOpen] = useState(false);
  const [proctorSession, setProctorSession] = useState<InterviewAiSession | null>(null);

  const sessions = useMemo(() => interviewQuery.data?.sessions ?? [], [interviewQuery.data]);
  const completedSessions = sessions.filter((s) => s.status === "completed");
  const hasSummary = completedSessions.some((s) => s.ai_summary);
  const totalFlags = sessions.reduce((n, s) => n + s.proctor.flags, 0);
  const totalSnapshots = sessions.reduce((n, s) => n + s.proctor.snapshots, 0);

  const checklist = [
    {
      label: "Undangan interview dikirim",
      done: sessions.length > 0,
      hint: sessions.length > 0 ? `${sessions.length} undangan` : undefined,
    },
    {
      label: "Interview selesai",
      done: completedSessions.length > 0,
      hint:
        completedSessions.length > 0 ? `${completedSessions.length} sesi selesai` : undefined,
    },
    { label: "Kesimpulan AI tersedia", done: hasSummary },
    {
      label: "Analitik proctoring terekam",
      done: totalFlags + totalSnapshots > 0,
      hint:
        totalFlags + totalSnapshots > 0
          ? `${totalFlags} flag · ${totalSnapshots} snapshot`
          : undefined,
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const positionTitle = candidate.positions?.title ?? "posisi yang dilamar";

  const handleWaTemplate = (template: (typeof WA_TEMPLATES)[number]) => {
    const link = buildWaLink(candidate.phone, template.build(candidate.full_name, positionTitle));
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    logWa.mutate({ id: candidate.id, template: template.key });
  };

  const copySessionLink = async (session: InterviewAiSession) => {
    if (!session.token) return;
    const link = `${window.location.origin}/interview/${session.token}`;
    await navigator.clipboard.writeText(link).catch(() => undefined);
    toast.success("Link interview disalin");
  };

  if (interviewQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (interviewQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border py-10">
        <p className="text-sm text-red-600 dark:text-red-400">
          {interviewQuery.error instanceof Error
            ? interviewQuery.error.message
            : "Gagal memuat data interview"}
        </p>
        <Button size="sm" variant="outline" onClick={() => interviewQuery.refetch()}>
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
            <BotMessageSquare className="size-4 text-violet-500" /> Interview AI
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

      {/* ── Hasil interview ── */}
      <div className="rounded-xl border border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Hasil Interview</h4>
          <Button size="sm" variant="outline" onClick={() => setSendOpen(true)}>
            <Plus className="size-3.5" /> Kirim undangan
          </Button>
        </div>

        {sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Belum ada undangan interview. Kirim undangan untuk memulai interview AI (suara, wajib
            on-cam).
          </p>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => (
              <div key={session.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">
                    {SESSION_STATUS_LABELS[session.status]}
                  </span>
                  {session.status === "in_progress" && (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <Mic className="size-3.5 animate-pulse" /> live
                    </span>
                  )}
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
                  {session.token &&
                    (session.status === "sent" || session.status === "in_progress") && (
                      <button
                        type="button"
                        onClick={() => copySessionLink(session)}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                      >
                        <Copy className="size-3" /> salin link
                      </button>
                    )}
                </div>

                {session.status === "completed" && <AiSummaryCard session={session} />}
                <TranscriptSection session={session} />
                {(session.status === "completed" || session.status === "in_progress") && (
                  <RecordingsSection sessionId={session.id} />
                )}
              </div>
            ))}
          </div>
        )}
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
            disabled={moving || completedSessions.length === 0}
            onClick={() => onMove("offer")}
          >
            Lolos → Offer <ArrowRight className="size-3.5" />
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
        {completedSessions.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Tombol &quot;Lolos → Offer&quot; aktif setelah minimal satu sesi interview selesai.
          </p>
        )}
      </div>

      {sendOpen && (
        <InterviewSendDialog
          candidate={candidate}
          positionTitle={positionTitle}
          open
          onOpenChange={setSendOpen}
        />
      )}
      {proctorSession && (
        <InterviewProctorDialog
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
