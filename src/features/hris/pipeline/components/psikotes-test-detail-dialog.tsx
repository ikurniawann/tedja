"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogPanel,
  DialogPanelBody,
  DialogPanelHeader,
  DialogPanelTitle,
  DialogPanelDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PAPI_SCALES, PAPI_SCALE_CODES, scoreBadgeClass } from "@/lib/recruitment/psikotes";
import { useRequestPsikotesAiInsight, useReviewPsikotesTest } from "../mutations";
import { usePsikotesTestAnswers } from "../queries";
import type { McqAnswerItem, PapiAnswerItem, PsikotesSessionTest } from "../api";
import { PSIKOTES_TEST_STATUS } from "./psikotes-status";

const MIN_OBSERVATION_CHARS = 20;

function AnswersLoading() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> Memuat rincian soal…
    </p>
  );
}

/** Daftar soal MCQ lengkap: teks soal, opsi, jawaban kandidat vs kunci. */
function McqQuestionList({ items }: { items: McqAnswerItem[] }) {
  return (
    <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
      {items.map((item, i) => (
        <div key={item.id} className="rounded-lg border border-border p-3">
          <div className="flex items-start gap-2">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                item.is_correct
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                  : "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300"
              }`}
            >
              {i + 1}
            </span>
            {item.body ? (
              <p className="text-sm text-foreground">{item.body}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                Soal sudah dihapus dari bank soal
              </p>
            )}
          </div>
          {item.options && (
            <div className="mt-2 space-y-1 pl-8">
              {item.options.map((opt) => {
                const isGiven = opt.key === item.given;
                const isKey = opt.key === item.correct_key;
                return (
                  <div
                    key={opt.key}
                    className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
                      isKey
                        ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200"
                        : isGiven
                          ? "bg-red-50 text-red-900 dark:bg-red-500/15 dark:text-red-200"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold uppercase">{opt.key}.</span>
                    <span className="flex-1">{opt.text}</span>
                    {isGiven && <span className="shrink-0 font-medium">jawaban kandidat</span>}
                    {isKey && <Check className="mt-0.5 size-3.5 shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}
          {item.given === null && (
            <p className="mt-1.5 pl-8 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              Tidak dijawab
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Daftar pasangan PAPI: pernyataan A/B, pilihan kandidat + kode skala. */
function PapiAnswerList({ items }: { items: PapiAnswerItem[] }) {
  return (
    <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
      {items.map((item, i) => {
        const options = item.options;
        return (
          <div key={item.id} className="rounded-lg border border-border px-3 py-2">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Pasangan {i + 1}
              {item.body ? ` · ${item.body}` : ""}
              {item.given === null && (
                <span className="ml-1 text-amber-600 dark:text-amber-400">— tidak dijawab</span>
              )}
            </p>
            {options ? (
              (["a", "b"] as const).map((k) => {
                const chosen = item.given === k;
                return (
                  <div
                    key={k}
                    className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-xs ${
                      chosen
                        ? "bg-violet-50 font-medium text-violet-900 dark:bg-violet-500/15 dark:text-violet-200"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span className="font-semibold uppercase">{k}.</span>
                    <span className="flex-1">{options[k].text}</span>
                    <span
                      className="shrink-0 text-[10px] opacity-70"
                      title={PAPI_SCALES[options[k].scale]}
                    >
                      {options[k].scale}
                    </span>
                    {chosen && <Check className="mt-0.5 size-3.5 shrink-0" />}
                  </div>
                );
              })
            ) : (
              <p className="text-xs italic text-muted-foreground">Detail soal tidak tersedia</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface PsikotesTestDetailDialogProps {
  test: PsikotesSessionTest;
  candidateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail hasil satu instrumen:
 * - MCQ: skor + rincian benar/salah per soal.
 * - PAPI: skala dominan + tabel 20 skala.
 * - Gambar: preview (storage private via /api/psikotes/files) + insight AI
 *   DeepSeek dari observasi HR (indikatif, bukan keputusan final) + form
 *   review manual (kesimpulan → status reviewed, reviewer terekam).
 */
export function PsikotesTestDetailDialog({
  test,
  candidateId,
  open,
  onOpenChange,
}: PsikotesTestDetailDialogProps) {
  const review = useReviewPsikotesTest();
  const aiInsight = useRequestPsikotesAiInsight();
  const [reviewNotes, setReviewNotes] = useState(test.review_notes ?? "");
  const existingInsight = test.instrument_kind === "drawing" ? test.ai_insight : null;
  const [observation, setObservation] = useState(existingInsight?.observation ?? "");

  const statusMeta = PSIKOTES_TEST_STATUS[test.status];
  const canRequestInsight = test.status === "perlu_review" || test.status === "reviewed";
  // Rincian soal+jawaban hanya relevan utk MCQ & PAPI yang sudah dikerjakan.
  const answersQuery = usePsikotesTestAnswers(
    test.instrument_kind !== "drawing" && test.status === "selesai" ? test.id : null
  );

  const handleRequestInsight = () => {
    const trimmed = observation.trim();
    // Kosong = mode otomatis (OpenAI vision membaca gambar); terisi = manual.
    if (trimmed && trimmed.length < MIN_OBSERVATION_CHARS) {
      toast.error(
        `Tulis observasi minimal ${MIN_OBSERVATION_CHARS} karakter, atau kosongkan agar AI membaca gambarnya`
      );
      return;
    }
    aiInsight.mutate(
      { testId: test.id, candidateId, observation: trimmed || undefined },
      {
        onSuccess: (record) => {
          setObservation(record.observation);
          toast.success("Insight AI dibuat");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal membuat insight AI"),
      }
    );
  };

  const handleReview = () => {
    if (!reviewNotes.trim()) {
      toast.error("Tulis kesimpulan review terlebih dahulu");
      return;
    }
    review.mutate(
      { testId: test.id, candidateId, reviewNotes: reviewNotes.trim() },
      {
        onSuccess: () => {
          toast.success("Review tersimpan");
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Gagal menyimpan review"),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPanel size="md">
        <DialogPanelHeader>
          <DialogPanelTitle>{test.instrument_name}</DialogPanelTitle>
          <DialogPanelDescription>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.badge}`}>
              {statusMeta.label}
            </span>
            {test.completed_at &&
              ` · selesai ${new Date(test.completed_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
          </DialogPanelDescription>
        </DialogPanelHeader>
        <DialogPanelBody className="space-y-4">
          {test.instrument_kind === "mcq" && test.score_detail && (
            <>
              <div className="flex items-baseline gap-3">
                <span
                  className={`rounded-lg px-3 py-1 text-2xl font-bold ${scoreBadgeClass(test.score ?? 0)}`}
                >
                  {test.score ?? 0}%
                </span>
                <span className="text-sm text-muted-foreground">
                  {test.score_detail.correct}/{test.score_detail.total} benar
                </span>
              </div>
              {test.score_detail.per_question && (
                <div>
                  <Label className="mb-1.5 block text-xs font-medium">Rincian per Soal</Label>
                  {answersQuery.isLoading ? (
                    <AnswersLoading />
                  ) : answersQuery.data?.kind === "mcq" && answersQuery.data.items.length > 0 ? (
                    <McqQuestionList items={answersQuery.data.items} />
                  ) : (
                    // Fallback chip ringkas bila rincian soal gagal dimuat.
                    <div className="flex flex-wrap gap-1.5">
                      {test.score_detail.per_question.map((q, i) => (
                        <span
                          key={q.id}
                          title={q.given ? `jawaban: ${q.given.toUpperCase()}` : "tidak dijawab"}
                          className={`flex size-8 items-center justify-center rounded-md text-xs font-semibold ${
                            q.is_correct
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                              : "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300"
                          }`}
                        >
                          {i + 1}
                        </span>
                      ))}
                    </div>
                  )}
                  {answersQuery.isError && (
                    <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
                      Gagal memuat teks soal — menampilkan ringkasan benar/salah saja.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {test.instrument_kind === "forced_choice" && test.score_detail && (
            <>
              {test.score_detail.dominant.length > 0 && (
                <div>
                  <Label className="mb-1 block text-xs font-medium">Skala Dominan</Label>
                  {test.score_detail.dominant.map((d) => (
                    <p key={d.code} className="text-lg font-semibold text-foreground">
                      {d.code} — {d.label}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        ({d.count} pilihan)
                      </span>
                    </p>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {test.score_detail.answered}/{test.score_detail.total} pasangan dijawab.
                Interpretasi naratif ditulis HR (tidak digenerate otomatis).
              </p>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                {[...PAPI_SCALE_CODES]
                  .sort((a, b) => (test.score_detail?.scales[b] ?? 0) - (test.score_detail?.scales[a] ?? 0))
                  .map((code) => {
                    const count = test.score_detail?.scales[code] ?? 0;
                    return (
                      <div
                        key={code}
                        title={PAPI_SCALES[code]}
                        className={`rounded-md px-2 py-1.5 text-center text-xs ${
                          count > 0
                            ? "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span className="font-semibold">{code}</span> · {count}
                      </div>
                    );
                  })}
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium">Rincian Soal &amp; Jawaban</Label>
                {answersQuery.isLoading ? (
                  <AnswersLoading />
                ) : answersQuery.data?.kind === "forced_choice" &&
                  answersQuery.data.items.length > 0 ? (
                  <PapiAnswerList items={answersQuery.data.items} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {answersQuery.isError
                      ? "Gagal memuat rincian soal."
                      : "Rincian soal tidak tersedia (bank soal kosong atau sudah dihapus)."}
                  </p>
                )}
              </div>
            </>
          )}

          {test.instrument_kind === "drawing" && (
            <>
              {test.attachment_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/psikotes/files/${test.attachment_path}`}
                  alt={`Hasil ${test.instrument_name}`}
                  className="max-h-96 w-full rounded-lg border border-border object-contain"
                />
              ) : (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  Kandidat tidak mengunggah gambar (waktu habis).
                </p>
              )}
              {canRequestInsight && (
                <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-violet-600 dark:text-violet-400" />
                    <Label className="text-xs font-medium text-violet-900 dark:text-violet-200">
                      Insight AI (DeepSeek)
                    </Label>
                  </div>
                  <Textarea
                    value={observation}
                    onChange={(e) => setObservation(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    placeholder="Opsional — kosongkan agar AI membaca gambarnya langsung, atau tulis observasi Anda sendiri (mis. pohon besar memenuhi kertas, batang tebal, tanpa akar…)."
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleRequestInsight}
                    disabled={aiInsight.isPending}
                  >
                    {aiInsight.isPending ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Menganalisis…
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4" />
                        {existingInsight
                          ? "Analisa Ulang oleh AI"
                          : observation.trim()
                            ? "Analisa Observasi oleh AI"
                            : "Analisa Gambar oleh AI"}
                      </>
                    )}
                  </Button>

                  {existingInsight && (
                    <div className="space-y-2.5 rounded-md border border-border bg-background p-3 text-sm">
                      <p className="text-foreground">{existingInsight.insight.ringkasan}</p>
                      {existingInsight.insight.indikasi.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground">Indikasi</p>
                          <ul className="space-y-1">
                            {existingInsight.insight.indikasi.map((item, i) => (
                              <li key={i} className="text-xs text-foreground">
                                <span className="font-medium">{item.aspek}:</span> {item.insight}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {existingInsight.insight.perhatikan_saat_interview.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground">
                            Perhatikan saat interview
                          </p>
                          <ul className="list-disc space-y-0.5 pl-4">
                            {existingInsight.insight.perhatikan_saat_interview.map((item, i) => (
                              <li key={i} className="text-xs text-foreground">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="border-t border-border pt-2 text-[11px] italic text-muted-foreground">
                        {existingInsight.insight.keterbatasan}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {existingInsight.observation_source === "ai"
                          ? `gambar dibaca ${existingInsight.vision_model ?? "AI vision"} → insight ${existingInsight.model}`
                          : `observasi manual → insight ${existingInsight.model}`}{" "}
                        · diminta {existingInsight.created_by_name} ·{" "}
                        {new Date(existingInsight.created_at).toLocaleString("id-ID", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  )}
                  <p className="text-[11px] text-violet-700 dark:text-violet-300">
                    Insight AI bersifat indikatif sebagai bahan pertimbangan — keputusan tetap di
                    tangan HRD melalui review manual di bawah.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Kesimpulan Review Manual</Label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Contoh: Gambar menunjukkan stabilitas dan keterbukaan terhadap pengalaman baru…"
                />
                {test.status === "reviewed" && test.reviewed_by_name && (
                  <p className="text-xs text-muted-foreground">
                    Direview oleh {test.reviewed_by_name}
                  </p>
                )}
              </div>
            </>
          )}
        </DialogPanelBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          {test.instrument_kind === "drawing" &&
            (test.status === "perlu_review" || test.status === "reviewed") && (
              <Button type="button" onClick={handleReview} disabled={review.isPending}>
                {review.isPending && <Loader2 className="size-4 animate-spin" />}
                {test.status === "reviewed" ? "Perbarui Review" : "Tandai Sudah Direview"}
              </Button>
            )}
        </DialogFooter>
      </DialogPanel>
    </Dialog>
  );
}
