import { createBrowserClient } from "@/lib/pg/browser-client";
import type { Candidate, Brand } from "@/types";
import type { PapiScaleCode } from "@/lib/recruitment/psikotes";
import type { PipelineStage } from "./types";

export async function fetchPipelineCandidates(): Promise<Candidate[]> {
  const db = createBrowserClient();
  const { data, error } = await db
    .from("candidates")
    .select("*, brands(name), positions(title)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as Candidate[]) ?? [];
}

export async function fetchPipelineBrands(): Promise<Brand[]> {
  const db = createBrowserClient();
  const { data, error } = await db
    .from("brands")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data as Brand[]) ?? [];
}

export async function updateCandidateStage(id: string, status: PipelineStage) {
  // via endpoint khusus supaya perpindahan selalu tercatat di activity log
  const res = await fetch(`/api/candidates/${id}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memindahkan kandidat");
}

// ── Catatan internal HR (timeline) ─────────────────────────────────────

export interface CandidateNote {
  id: string;
  candidate_id: string;
  content: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export async function fetchCandidateNotes(candidateId: string): Promise<CandidateNote[]> {
  const res = await fetch(`/api/candidates/${candidateId}/notes`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat catatan");
  return json.data ?? [];
}

export async function addCandidateNote(candidateId: string, content: string): Promise<CandidateNote> {
  const res = await fetch(`/api/candidates/${candidateId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal menyimpan catatan");
  return json.data;
}

// ── Hasil screening call (1 baris per kandidat) ────────────────────────

export type ScreeningRecommendation = "lolos" | "hold" | "tidak_lolos";

export interface CandidateScreening {
  id: string;
  candidate_id: string;
  contacted: boolean;
  interested: boolean | null;
  availability_note: string | null;
  confirmed_salary: number | null;
  willing_shift: boolean | null;
  willing_placement: boolean | null;
  notes: string | null;
  recommendation: ScreeningRecommendation | null;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export type ScreeningPayload = Omit<
  CandidateScreening,
  "id" | "candidate_id" | "updated_by" | "updated_by_name" | "created_at" | "updated_at"
>;

export async function fetchCandidateScreening(
  candidateId: string
): Promise<CandidateScreening | null> {
  const res = await fetch(`/api/candidates/${candidateId}/screening`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat hasil screening");
  return json.data;
}

export async function saveCandidateScreening(
  candidateId: string,
  payload: ScreeningPayload
): Promise<CandidateScreening> {
  const res = await fetch(`/api/candidates/${candidateId}/screening`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal menyimpan hasil screening");
  return json.data;
}

export type WaTemplateKey =
  | "undangan_screening"
  | "lolos_psikotes"
  | "undangan_psikotes"
  | "undangan_interview"
  | "lolos_interview"
  | "lolos_offer"
  | "offer_terkirim"
  | "penolakan";

export async function logWaTemplateActivity(
  candidateId: string,
  template: WaTemplateKey
): Promise<void> {
  const res = await fetch(`/api/candidates/${candidateId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "Gagal mencatat aktivitas");
  }
}

// ── Panel Psikotes (EPIC-002 TG4) ───────────────────────────────────────

export type PsikotesRecommendation = "lolos" | "hold" | "tidak_lolos";

export interface PsikotesSummary {
  id: string;
  candidate_id: string;
  recommendation: PsikotesRecommendation | null;
  notes: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

/** Selaras McqScoreResult["detail"] di lib/recruitment/psikotes-scoring.ts. */
export interface McqScoreDetail {
  total: number;
  correct: number;
  per_question?: { id: string; given: string | null; correct_key: string; is_correct: boolean }[];
}

/** Insight AI tes gambar — indikatif utk HRD, bukan keputusan final. */
export interface DrawingAiInsightRecord {
  observation: string;
  /** "ai" = observasi otomatis dari OpenAI vision; "manual" = ditulis HRD.
   *  Undefined utk record lama (sebelum mode otomatis ada) = manual. */
  observation_source?: "manual" | "ai";
  vision_model?: string | null;
  insight: {
    ringkasan: string;
    indikasi: { aspek: string; insight: string }[];
    perhatikan_saat_interview: string[];
    keterbatasan: string;
  };
  model: string;
  created_at: string;
  created_by_name: string;
}

/** Selaras PapiScoreResult di lib/recruitment/psikotes-scoring.ts. */
export interface PapiScoreDetail {
  scales: Record<PapiScaleCode, number>;
  dominant: { code: PapiScaleCode; label: string; count: number }[];
  answered: number;
  total: number;
}

interface PsikotesSessionTestBase {
  id: string;
  session_id: string;
  status: "pending" | "in_progress" | "selesai" | "perlu_review" | "reviewed";
  score: number | null;
  attachment_path: string | null;
  review_notes: string | null;
  reviewed_by_name: string | null;
  sort_order: number;
  started_at: string | null;
  completed_at: string | null;
  instrument_code: string;
  instrument_name: string;
}

/** Discriminated union: bentuk score_detail terikat pada jenis instrumen. */
export type PsikotesSessionTest =
  | (PsikotesSessionTestBase & {
      instrument_kind: "mcq";
      score_detail: McqScoreDetail | null;
      ai_insight: null;
    })
  | (PsikotesSessionTestBase & {
      instrument_kind: "forced_choice";
      score_detail: PapiScoreDetail | null;
      ai_insight: null;
    })
  | (PsikotesSessionTestBase & {
      instrument_kind: "drawing";
      score_detail: null;
      ai_insight: DrawingAiInsightRecord | null;
    });

export interface PsikotesSession {
  id: string;
  /** null utk role read-only (hiring_manager) — token = kredensial tes */
  token: string | null;
  status: "draft" | "sent" | "in_progress" | "completed" | "expired";
  webcam_consent: boolean | null;
  invited_at: string | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by_name: string | null;
  created_at: string;
  proctor: { flags: number; snapshots: number };
  tests: PsikotesSessionTest[];
}

export interface CandidatePsikotesData {
  summary: PsikotesSummary | null;
  sessions: PsikotesSession[];
}

export async function fetchCandidatePsikotes(candidateId: string): Promise<CandidatePsikotesData> {
  const res = await fetch(`/api/candidates/${candidateId}/psikotes`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat data psikotes");
  return json.data;
}

export async function createPsikotesSession(
  candidateId: string,
  payload: { instrument_ids: string[]; expires_days: number }
): Promise<{ id: string; token: string; expires_at: string }> {
  const res = await fetch(`/api/candidates/${candidateId}/psikotes/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal membuat undangan tes");
  return json.data;
}

export type PsikotesSummaryPayload = Pick<PsikotesSummary, "recommendation" | "notes">;

export async function savePsikotesSummary(
  candidateId: string,
  payload: PsikotesSummaryPayload
): Promise<PsikotesSummary> {
  const res = await fetch(`/api/candidates/${candidateId}/psikotes/summary`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal menyimpan rekomendasi");
  return json.data;
}

export interface PsikotesProctorEvent {
  id: string;
  event_type: "tab_blur" | "fullscreen_exit" | "paste" | "disconnect" | "webcam_snapshot";
  meta: Record<string, string | number | boolean> | null;
  storage_path: string | null;
  created_at: string;
}

export async function fetchPsikotesProctorEvents(
  sessionId: string
): Promise<PsikotesProctorEvent[]> {
  const res = await fetch(`/api/psikotes/sessions/${sessionId}/proctor-events`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat arsip proctoring");
  return json.data ?? [];
}

/** Rincian soal + jawaban kandidat (HR-only, GET /session-tests/[id]/answers). */
export interface McqAnswerItem {
  id: string;
  /** null = soal sudah dihapus dari bank; skor tetap dari snapshot. */
  body: string | null;
  options: { key: string; text: string }[] | null;
  given: string | null;
  correct_key: string;
  is_correct: boolean;
}

export interface PapiAnswerItem {
  id: string;
  body: string | null;
  options: {
    a: { text: string; scale: PapiScaleCode };
    b: { text: string; scale: PapiScaleCode };
  } | null;
  given: "a" | "b" | null;
}

export type PsikotesTestAnswers =
  | { kind: "mcq"; items: McqAnswerItem[] }
  | { kind: "forced_choice"; items: PapiAnswerItem[] };

export async function fetchPsikotesTestAnswers(testId: string): Promise<PsikotesTestAnswers> {
  const res = await fetch(`/api/psikotes/session-tests/${testId}/answers`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat rincian jawaban");
  return json.data;
}

/** observation kosong/undefined = mode otomatis (AI membaca gambarnya). */
export async function requestPsikotesAiInsight(
  testId: string,
  observation?: string
): Promise<DrawingAiInsightRecord> {
  const res = await fetch(`/api/psikotes/session-tests/${testId}/ai-insight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ observation: observation ?? "" }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal membuat insight AI");
  return json.data;
}

export async function reviewPsikotesTest(testId: string, reviewNotes: string): Promise<void> {
  const res = await fetch(`/api/psikotes/session-tests/${testId}/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_notes: reviewNotes }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "Gagal menyimpan review");
  }
}

export interface InterviewRecording {
  path: string;
  size: number;
  modified_at: string;
}

export async function fetchInterviewRecordings(sessionId: string): Promise<InterviewRecording[]> {
  const res = await fetch(`/api/interview/sessions/${sessionId}/recordings`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat rekaman");
  return json.data ?? [];
}

// ── Offer (EPIC-004) ────────────────────────────────────────────────────

export interface OfferSalaryReference {
  /** ekspektasi gaji dari form lamaran */
  expected_salary: number | null;
  /** ekspektasi yang diucapkan saat interview AI (ai_summary.ekspektasi_gaji) */
  interview_expectation: { disebutkan: boolean; nilai: string | null; catatan: string } | null;
  position_title: string | null;
  salary_min: number | null;
  salary_max: number | null;
}

export interface CandidateOffer {
  id: string;
  version: number;
  /** null utk role read-only (hiring_manager) — token = kredensial portal */
  token: string | null;
  status: "sent" | "negotiating" | "accepted" | "declined" | "expired";
  position_title: string | null;
  base_salary: number;
  benefits: string[];
  start_date: string | null;
  notes: string | null;
  response_note: string | null;
  responded_at: string | null;
  response_source: "portal" | "manual" | null;
  sent_at: string | null;
  expires_at: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface CandidateOffersData {
  salary_reference: OfferSalaryReference;
  offers: CandidateOffer[];
}

export async function fetchCandidateOffers(candidateId: string): Promise<CandidateOffersData> {
  const res = await fetch(`/api/candidates/${candidateId}/offers`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat data offer");
  return json.data;
}

export interface OfferCreatePayload {
  base_salary: number;
  benefits: string[];
  start_date?: string | null;
  notes?: string | null;
  expires_days: number;
}

export async function createCandidateOffer(
  candidateId: string,
  payload: OfferCreatePayload
): Promise<{ id: string; version: number; token: string; expires_at: string }> {
  const res = await fetch(`/api/candidates/${candidateId}/offers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal membuat offer");
  return json.data;
}

export async function recordOfferResponse(
  offerId: string,
  payload: { status: "negotiating" | "accepted" | "declined"; note?: string | null }
): Promise<void> {
  const res = await fetch(`/api/offers/${offerId}/response`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "Gagal mencatat respons");
  }
}

// ── Interview AI (EPIC-003) ─────────────────────────────────────────────

export interface InterviewAiSummaryData {
  ringkasan: string;
  relevansi: {
    skor: number;
    kesimpulan: "relevan" | "cukup_relevan" | "kurang_relevan";
    alasan: string;
  };
  keahlian: string[];
  ekspektasi_gaji: { disebutkan: boolean; nilai: string | null; catatan: string };
  red_flags: string[];
  perhatikan_saat_interview_lanjutan: string[];
  keterbatasan: string;
}

export interface InterviewAiTurn {
  id: string;
  session_id: string;
  turn_no: number;
  topic: string | null;
  question: string;
  answer_transcript: string | null;
  answer_mode: "voice" | "text" | null;
  answer_audio_path: string | null;
  asked_at: string;
  answered_at: string | null;
}

export interface InterviewAiSession {
  id: string;
  /** null utk role read-only (hiring_manager) — token = kredensial interview */
  token: string | null;
  status: "sent" | "in_progress" | "completed" | "expired";
  webcam_consent: boolean | null;
  config: { max_questions?: number } | null;
  ai_summary: InterviewAiSummaryData | null;
  summary_model: string | null;
  summarized_at: string | null;
  invited_at: string | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by_name: string | null;
  created_at: string;
  proctor: { flags: number; snapshots: number };
  turns: InterviewAiTurn[];
}

export interface CandidateInterviewData {
  sessions: InterviewAiSession[];
}

export async function fetchCandidateInterview(
  candidateId: string
): Promise<CandidateInterviewData> {
  const res = await fetch(`/api/candidates/${candidateId}/interview`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat data interview");
  return json.data;
}

export async function createInterviewSession(
  candidateId: string,
  payload: { expires_days: number; max_questions: number }
): Promise<{ id: string; token: string; expires_at: string }> {
  const res = await fetch(`/api/candidates/${candidateId}/interview/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal membuat undangan interview");
  return json.data;
}

export interface InterviewProctorEvent {
  id: string;
  event_type:
    | "tab_blur"
    | "fullscreen_exit"
    | "paste"
    | "disconnect"
    | "webcam_snapshot"
    | "face_not_detected"
    | "multiple_faces"
    | "camera_off";
  meta: Record<string, string | number | boolean> | null;
  storage_path: string | null;
  created_at: string;
}

export async function fetchInterviewProctorEvents(
  sessionId: string
): Promise<InterviewProctorEvent[]> {
  const res = await fetch(`/api/interview/sessions/${sessionId}/proctor-events`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat arsip proctoring");
  return json.data ?? [];
}

// ── AI analysis (DeepSeek) ──────────────────────────────────────────────

export interface CandidateAiAnalysis {
  id: string;
  candidate_id: string;
  extracted: {
    nama: string | null;
    email: string | null;
    no_hp: string | null;
    sumber: string | null;
    pendidikan: string | null;
    pengalaman: string | null;
    metode_ekstraksi?: string;
  };
  summary: string | null;
  match_score: number | null;
  match_reason: string | null;
  job_context: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchCandidateAiAnalysis(
  candidateId: string
): Promise<CandidateAiAnalysis | null> {
  const res = await fetch(`/api/candidates/${candidateId}/ai-analysis`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Gagal memuat analisis");
  return json.data;
}

export async function runCandidateAiAnalysis(
  candidateId: string
): Promise<CandidateAiAnalysis> {
  const res = await fetch(`/api/candidates/${candidateId}/ai-analysis`, {
    method: "POST",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Analisis gagal");
  return json.data;
}
