import { NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { INTERVIEW_MAX_QUESTIONS_DEFAULT, INTERVIEW_MAX_QUESTIONS_LIMIT } from "./interview-ai";

/**
 * Helper bersama endpoint publik sesi interview AI
 * (/api/interview/session/[token]) — pola sama dgn psikotes-session:
 * kandidat anonim, identitas = token sesi; rate limit di-key ke token.
 */

export const INTERVIEW_TOKEN_RE = /^[a-f0-9]{48,128}$/i;

/** Fallback masa hidup sesi bila expires_at NULL (jangan pernah abadi). */
const MAX_SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/** Limit per menit per sesi — endpoint penulis disk/LLM jauh lebih ketat. */
const BUCKET_LIMITS: Record<string, number> = {
  answer: 6,
  proctor: 12,
};

/** Batas snapshot webcam tersimpan per sesi (kuota storage). */
export const MAX_INTERVIEW_SNAPSHOTS_PER_SESSION = 300;

export interface InterviewSessionRow {
  id: string;
  candidate_id: string;
  token: string;
  status: "sent" | "in_progress" | "completed" | "expired";
  webcam_consent: boolean | null;
  config: { max_questions?: number } | null;
  ai_summary: unknown;
  invited_at: string | null;
  expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  candidate_name: string;
  position_title: string | null;
}

export interface InterviewTurnRow {
  id: string;
  session_id: string;
  turn_no: number;
  topic: string | null;
  question: string;
  question_audio_path: string | null;
  answer_audio_path: string | null;
  answer_transcript: string | null;
  answer_mode: "voice" | "text" | null;
  asked_at: string;
  answered_at: string | null;
}

export function invalidInterviewTokenResponse() {
  return NextResponse.json({ error: "Link interview tidak berlaku" }, { status: 404 });
}

export function interviewRateLimitedResponse() {
  return NextResponse.json(
    { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
    { status: 429 }
  );
}

export function interviewSessionRateLimited(sessionId: string, bucket: string): boolean {
  return !checkRateLimit(`interview_session_${bucket}_${sessionId}`, BUCKET_LIMITS[bucket]).allowed;
}

/** Muat sesi via token + auto-expire bila lewat masa berlaku. */
export async function loadInterviewSessionByToken(
  token: string
): Promise<InterviewSessionRow | null> {
  if (!INTERVIEW_TOKEN_RE.test(token)) return null;
  const session = await queryOne<InterviewSessionRow>(
    `SELECT s.id, s.candidate_id, s.token, s.status, s.webcam_consent, s.config,
            s.ai_summary, s.invited_at, s.expires_at, s.started_at, s.completed_at,
            c.full_name AS candidate_name, p.title AS position_title
     FROM recruitment.interview_ai_sessions s
     JOIN recruitment.candidates c ON c.id = s.candidate_id
     LEFT JOIN hris.positions p ON p.id = c.position_id
     WHERE s.token = $1`,
    [token]
  );
  if (!session) return null;

  const isExpirable = session.status === "sent" || session.status === "in_progress";
  const expiresAtMs = session.expires_at
    ? new Date(session.expires_at).getTime()
    : new Date(session.invited_at ?? 0).getTime() + MAX_SESSION_LIFETIME_MS;
  if (isExpirable && expiresAtMs < Date.now()) {
    await queryOne(
      `UPDATE recruitment.interview_ai_sessions SET status = 'expired' WHERE id = $1 RETURNING id`,
      [session.id]
    );
    return { ...session, status: "expired" };
  }
  return session;
}

/** Semua turn satu sesi, urut nomor. */
export async function loadInterviewTurns(sessionId: string): Promise<InterviewTurnRow[]> {
  return query<InterviewTurnRow>(
    `SELECT id, session_id, turn_no, topic, question, question_audio_path,
            answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at
     FROM recruitment.interview_ai_turns
     WHERE session_id = $1
     ORDER BY turn_no`,
    [sessionId]
  );
}

/** Batas jumlah pertanyaan sesi (dari config, di-clamp ke limit sistem). */
export function sessionMaxQuestions(session: InterviewSessionRow): number {
  const n = Number(session.config?.max_questions ?? INTERVIEW_MAX_QUESTIONS_DEFAULT);
  if (!Number.isFinite(n) || n < 3) return INTERVIEW_MAX_QUESTIONS_DEFAULT;
  return Math.min(INTERVIEW_MAX_QUESTIONS_LIMIT, Math.round(n));
}

/** Bentuk turn yang aman dikirim ke kandidat (tanpa path storage internal). */
export function sanitizeTurnForCandidate(turn: InterviewTurnRow) {
  return {
    id: turn.id,
    turn_no: turn.turn_no,
    question: turn.question,
    answer_transcript: turn.answer_transcript,
    answered_at: turn.answered_at,
    asked_at: turn.asked_at,
  };
}
