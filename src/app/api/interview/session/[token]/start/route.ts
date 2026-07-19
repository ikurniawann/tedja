import { NextRequest, NextResponse } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import { interviewStartSchema } from "@/lib/validations/interview";
import {
  loadInterviewSessionByToken,
  invalidInterviewTokenResponse,
  interviewRateLimitedResponse,
  interviewSessionRateLimited,
  sessionMaxQuestions,
  sanitizeTurnForCandidate,
  type InterviewTurnRow,
} from "@/lib/recruitment/interview-session";
import {
  generateNextInterviewQuestion,
  synthesizeInterviewSpeech,
} from "@/lib/recruitment/interview-ai";
import { savePrivateAudio } from "@/lib/storage-private";

/**
 * POST /api/interview/session/[token]/start — kandidat memulai interview.
 * Consent kamera WAJIB true (interview on-cam). Membuat pertanyaan pertama
 * (+ audio TTS) dan menandai sesi in_progress. Idempoten: bila sudah
 * in_progress, kembalikan pertanyaan aktif.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const session = await loadInterviewSessionByToken(token);
    if (!session) return invalidInterviewTokenResponse();
    if (interviewSessionRateLimited(session.id, "start")) return interviewRateLimitedResponse();

    if (session.status === "completed" || session.status === "expired") {
      return NextResponse.json({ error: "Sesi interview sudah berakhir" }, { status: 409 });
    }

    // Sudah berjalan → kembalikan turn aktif (refresh/reload di tengah sesi).
    if (session.status === "in_progress") {
      const current = await queryOne<InterviewTurnRow>(
        `SELECT id, session_id, turn_no, topic, question, question_audio_path,
                answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at
         FROM recruitment.interview_ai_turns
         WHERE session_id = $1 AND answered_at IS NULL
         ORDER BY turn_no LIMIT 1`,
        [session.id]
      );
      return NextResponse.json({
        data: { turn: current ? sanitizeTurnForCandidate(current) : null },
      });
    }

    const body = await req.json().catch(() => null);
    const parsed = interviewStartSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? "Payload tidak valid" },
        { status: 400 }
      );
    }

    const first = await generateNextInterviewQuestion({
      candidateName: session.candidate_name,
      positionTitle: session.position_title,
      turns: [],
      maxQuestions: sessionMaxQuestions(session),
    });
    if (first.action !== "ask" || !first.question) {
      return NextResponse.json({ error: "Gagal menyiapkan pertanyaan pertama" }, { status: 500 });
    }

    // TTS best-effort — interview tetap jalan (teks) bila TTS gagal.
    const ttsBuffer = await synthesizeInterviewSpeech(first.question);
    let audioPath: string | null = null;
    if (ttsBuffer) {
      const saved = await savePrivateAudio(ttsBuffer, `interview/${session.id}/questions`);
      audioPath = saved.path;
    }

    const turn = await withTransaction(async (client) => {
      await client.query(
        `UPDATE recruitment.interview_ai_sessions
         SET status = 'in_progress', webcam_consent = true, started_at = now()
         WHERE id = $1 AND status = 'sent'`,
        [session.id]
      );
      const res = await client.query(
        `INSERT INTO recruitment.interview_ai_turns
           (session_id, turn_no, topic, question, question_audio_path)
         VALUES ($1, 1, $2, $3, $4)
         ON CONFLICT (session_id, turn_no) DO UPDATE SET turn_no = EXCLUDED.turn_no
         RETURNING id, session_id, turn_no, topic, question, question_audio_path,
                   answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at`,
        [session.id, first.topic, first.question, audioPath]
      );
      return res.rows[0] as InterviewTurnRow;
    });

    return NextResponse.json({
      data: {
        turn: {
          ...sanitizeTurnForCandidate(turn),
          question_audio_base64: ttsBuffer ? ttsBuffer.toString("base64") : null,
        },
      },
    });
  } catch (error) {
    console.error("[interview-start] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
