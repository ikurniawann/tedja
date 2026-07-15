"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Circle,
  FileText,
  GraduationCap,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Save,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCandidateAiAnalysis, useCandidateNotes } from "../queries";
import { useRunAiAnalysis, useAddCandidateNote } from "../mutations";

/** Field minimal yang dibutuhkan panel — kompatibel dgn Candidate & CandidateView. */
export interface AppliedPanelCandidate {
  id: string;
  cv_url?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Action panel untuk stage Applied:
 * 1. Preview CV yang diupload
 * 2. Analisis CV oleh AI (DeepSeek): ekstraksi data + ringkasan + skor kecocokan
 * 3. Checklist kelengkapan (computed dari data, selalu akurat)
 * 4. Catatan internal HR
 */

function scoreColor(score: number) {
  if (score >= 75) return "text-emerald-600 bg-emerald-50 ring-emerald-200";
  if (score >= 50) return "text-amber-600 bg-amber-50 ring-amber-200";
  return "text-red-600 bg-red-50 ring-red-200";
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

function ExtractedField({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
        <div className="text-sm text-gray-800 break-words">{value || "—"}</div>
      </div>
    </div>
  );
}

export function AppliedActionPanel({
  candidate,
  showNotes = true,
}: {
  candidate: AppliedPanelCandidate;
  showNotes?: boolean;
}) {
  const analysisQuery = useCandidateAiAnalysis(candidate.id);
  const notesQuery = useCandidateNotes(candidate.id);
  const runAnalysis = useRunAiAnalysis();
  const addNote = useAddCandidateNote();

  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    setNoteDraft("");
  }, [candidate.id]);

  const notes = notesQuery.data ?? [];
  const analysis = analysisQuery.data;
  const isPdf = candidate.cv_url?.toLowerCase().endsWith(".pdf");
  const isImage = /\.(jpe?g|png)$/i.test(candidate.cv_url ?? "");

  const checklist = [
    { label: "Lampiran CV", done: Boolean(candidate.cv_url) },
    { label: "Analisis CV oleh AI vs Job Description", done: Boolean(analysis) },
    {
      label: "Kontak Kandidat (Email & HP)",
      done: Boolean(candidate.email?.trim()) && Boolean(candidate.phone?.trim()),
    },
    { label: "Catatan Internal HR", done: notes.length > 0 },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const handleAddNote = async () => {
    const content = noteDraft.trim();
    if (!content) return;
    await addNote.mutateAsync({ id: candidate.id, content });
    setNoteDraft("");
  };

  return (
    <div className="space-y-5">
      {/* ── Checklist ── */}
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-800">Checklist Applied</h4>
          <span className="text-xs font-medium text-gray-500">
            {doneCount}/{checklist.length}
          </span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${(doneCount / checklist.length) * 100}%` }}
          />
        </div>
        <div className="space-y-2">
          {checklist.map((c) => (
            <ChecklistItem key={c.label} done={c.done} label={c.label} />
          ))}
        </div>
      </div>

      {/* ── CV Preview ── */}
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <FileText className="size-4 text-gray-400" /> Lampiran CV
          </h4>
          {candidate.cv_url && (
            <a
              href={candidate.cv_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Buka di tab baru
            </a>
          )}
        </div>
        {!candidate.cv_url ? (
          <p className="text-sm text-gray-400">Belum ada CV yang diupload.</p>
        ) : isPdf ? (
          <iframe
            src={candidate.cv_url}
            title="Preview CV"
            className="h-[420px] w-full rounded-lg border border-gray-100 bg-gray-50"
          />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.cv_url}
            alt="Preview CV"
            className="max-h-[420px] w-full rounded-lg border border-gray-100 object-contain bg-gray-50"
          />
        ) : (
          <p className="text-sm text-gray-500">
            Preview tidak tersedia untuk format ini — gunakan tombol &quot;Buka di tab baru&quot;.
          </p>
        )}
      </div>

      {/* ── AI Analysis ── */}
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <Bot className="size-4 text-sky-500" /> Analisis CV (AI)
          </h4>
          <Button
            size="sm"
            variant={analysis ? "outline" : "default"}
            disabled={!candidate.cv_url || runAnalysis.isPending}
            onClick={() => runAnalysis.mutate(candidate.id)}
          >
            {runAnalysis.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Menganalisis…
              </>
            ) : analysis ? (
              <>
                <RefreshCw className="size-3.5" /> Analisis Ulang
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" /> Analisis CV
              </>
            )}
          </Button>
        </div>

        {runAnalysis.isError && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {runAnalysis.error instanceof Error
              ? runAnalysis.error.message
              : "Analisis gagal"}
          </p>
        )}

        {analysisQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <Loader2 className="size-4 animate-spin" /> Memuat analisis…
          </div>
        ) : !analysis ? (
          <p className="text-sm text-gray-400">
            Belum dianalisis. Klik &quot;Analisis CV&quot; untuk mengekstrak data CV dan
            menilai kecocokan dengan posisi yang dilamar.
          </p>
        ) : (
          <div className="space-y-4">
            {/* skor */}
            <div className="flex items-center gap-4">
              <div
                className={`flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-bold ring-4 ${scoreColor(analysis.match_score ?? 0)}`}
              >
                {analysis.match_score ?? "?"}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800">
                  Skor Kecocokan CV vs Posisi
                </div>
                <p className="text-xs text-gray-500">{analysis.match_reason}</p>
              </div>
            </div>

            {/* ringkasan */}
            {analysis.summary && (
              <div className="rounded-lg bg-sky-50 px-3 py-2.5 text-sm leading-relaxed text-sky-900">
                {analysis.summary}
              </div>
            )}

            {/* hasil ekstraksi */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ExtractedField icon={User} label="Nama" value={analysis.extracted?.nama} />
              <ExtractedField icon={Mail} label="Email" value={analysis.extracted?.email} />
              <ExtractedField icon={Phone} label="No HP" value={analysis.extracted?.no_hp} />
              <ExtractedField icon={Sparkles} label="Sumber" value={analysis.extracted?.sumber} />
              <ExtractedField
                icon={GraduationCap}
                label="Pendidikan"
                value={analysis.extracted?.pendidikan}
              />
              <ExtractedField
                icon={FileText}
                label="Pengalaman"
                value={analysis.extracted?.pengalaman}
              />
            </div>

            <p className="text-[11px] text-gray-400">
              Model {analysis.model} · dianalisis{" "}
              {new Date(analysis.updated_at).toLocaleString("id-ID")}
              {analysis.extracted?.metode_ekstraksi === "ocr" ? " · via OCR" : ""}
            </p>
          </div>
        )}
      </div>

      {/* ── Catatan Internal HR (timeline) ── */}
      {showNotes && (
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-800">Catatan Internal HR</h4>
          {notes.length > 0 && (
            <span className="text-xs text-gray-400">{notes.length} catatan</span>
          )}
        </div>

        {/* input catatan baru */}
        <Textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Tulis catatan baru… (jejak tersimpan per catatan)"
          rows={3}
          className="text-sm"
        />
        {addNote.isError && (
          <p className="mt-1.5 text-xs text-red-600">
            {addNote.error instanceof Error ? addNote.error.message : "Gagal menyimpan catatan"}
          </p>
        )}
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddNote}
            disabled={addNote.isPending || !noteDraft.trim()}
          >
            {addNote.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Tambah Catatan
          </Button>
        </div>

        {/* timeline */}
        {notesQuery.isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="size-4 animate-spin" /> Memuat catatan…
          </div>
        ) : notes.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">
            Belum ada catatan. Catatan pertama akan memulai timeline.
          </p>
        ) : (
          <ol className="mt-4 space-y-0">
            {notes.map((note, idx) => (
              <li key={note.id} className="relative flex gap-3 pb-4 last:pb-0">
                {/* garis + titik timeline */}
                {idx < notes.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute top-3 left-[5px] h-full w-px bg-gray-200"
                  />
                )}
                <span
                  aria-hidden
                  className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-white bg-blue-400 ring-1 ring-gray-200"
                />
                <div className="min-w-0 flex-1 rounded-lg bg-gray-50 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-xs font-semibold text-gray-700">
                      {note.created_by_name || "HR"}
                    </span>
                    <time className="text-[11px] text-gray-400" dateTime={note.created_at}>
                      {new Date(note.created_at).toLocaleString("id-ID", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-gray-700">{note.content}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      )}
    </div>
  );
}
