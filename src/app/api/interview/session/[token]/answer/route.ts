import { NextRequest, NextResponse } from "next/server";
import { queryOne, withTransaction } from "@/lib/db";
import {
  loadInterviewSessionByToken,
  loadInterviewTurns,
  invalidInterviewTokenResponse,
  interviewRateLimitedResponse,
  interviewSessionRateLimited,
  sanitizeTurnForCandidate,
  sessionMaxQuestions,
  type InterviewTurnRow,
} from "@/lib/recruitment/interview-session";
import {
  generateNextInterviewQuestion,
  summarizeInterview,
  synthesizeInterviewSpeech,
  transcribeInterviewAudio,
  type InterviewTurnForAi,
} from "@/lib/recruitment/interview-ai";
import { savePrivateAudio, sniffAudioMime } from "@/lib/storage-private";

/**
 * POST /api/interview/session/[token]/answer — kandidat menjawab pertanyaan
 * aktif. multipart/form-data:
 * - turn_id  : id turn yang dijawab (guard idempotensi)
 * - mode     : "voice" | "text"
 * - audio    : File rekaman (mode voice) → transkrip Whisper
 * - answer_text : string (mode text)
 *
 * Setelah jawaban tersimpan: AI menentukan pertanyaan berikutnya (+TTS),
 * atau menutup sesi + membuat kesimpulan bila topik selesai / kuota habis.
 */

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const session = await loadInterviewSessionByToken(token);
    if (!session) return invalidInterviewTokenResponse();
    if (interviewSessionRateLimited(session.id, "answer")) return interviewRateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 409 });
    }

    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Ukuran permintaan terlalu besar" }, { status: 413 });
    }

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });

    const turnId = String(form.get("turn_id") ?? "");
    const mode = String(form.get("mode") ?? "");
    if (!UUID_RE.test(turnId) || (mode !== "voice" && mode !== "text")) {
      return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    }

    const turn = await queryOne<InterviewTurnRow>(
      `SELECT id, session_id, turn_no, topic, question, question_audio_path,
              answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at
       FROM recruitment.interview_ai_turns
       WHERE id = $1 AND session_id = $2`,
      [turnId, session.id]
    );
    if (!turn) return NextResponse.json({ error: "Pertanyaan tidak ditemukan" }, { status: 404 });
    if (turn.answered_at) {
      return NextResponse.json({ error: "Pertanyaan ini sudah dijawab" }, { status: 409 });
    }

    let transcript = "";
    let audioPath: string | null = null;
    let transcribeModel: string | null = null;

    if (mode === "voice") {
      const audio = form.get("audio");
      if (!(audio instanceof File) || audio.size === 0) {
        return NextResponse.json({ error: "Rekaman suara kosong" }, { status: 400 });
      }
      if (audio.size > MAX_AUDIO_BYTES) {
        return NextResponse.json({ error: "Rekaman terlalu besar (maks 15 MB)" }, { status: 413 });
      }
      const buffer = Buffer.from(await audio.arrayBuffer());
      const sniffed = sniffAudioMime(buffer);
      if (!sniffed) {
        return NextResponse.json({ error: "Format audio tidak dikenali" }, { status: 400 });
      }
      // Transkrip dulu — bila Whisper gagal, tidak ada yang tersimpan dan
      // kandidat bisa mengulang kirim rekaman yang sama.
      try {
        const result = await transcribeInterviewAudio(buffer, sniffed);
        transcript = result.transcript;
        transcribeModel = result.model;
      } catch (e) {
        console.error("[interview-answer] transcribe failed:", e);
        return NextResponse.json(
          { error: "Gagal mentranskrip suara — coba kirim ulang, atau ketik jawaban Anda" },
          { status: 502 }
        );
      }
      const saved = await savePrivateAudio(buffer, `interview/${session.id}/answers`);
      audioPath = saved.path;
    } else {
      transcript = String(form.get("answer_text") ?? "").trim().slice(0, MAX_TEXT_CHARS);
      if (!transcript) {
        return NextResponse.json({ error: "Jawaban kosong" }, { status: 400 });
      }
    }

    const updated = await queryOne<InterviewTurnRow>(
      `UPDATE recruitment.interview_ai_turns
       SET answer_transcript = $3, answer_audio_path = $4, answer_mode = $5,
           transcribe_model = $6, answered_at = now()
       WHERE id = $1 AND session_id = $2 AND answered_at IS NULL
       RETURNING id, session_id, turn_no, topic, question, question_audio_path,
                 answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at`,
      [turnId, session.id, transcript || null, audioPath, mode, transcribeModel]
    );
    if (!updated) {
      return NextResponse.json({ error: "Pertanyaan ini sudah dijawab" }, { status: 409 });
    }

    // ── Tentukan langkah berikutnya ────────────────────────────────────
    const turns = await loadInterviewTurns(session.id);
    const turnsForAi: InterviewTurnForAi[] = turns.map((t) => ({
      turn_no: t.turn_no,
      topic: t.topic,
      question: t.question,
      answer_transcript: t.answer_transcript,
    }));

    const next = await generateNextInterviewQuestion({
      candidateName: session.candidate_name,
      positionTitle: session.position_title,
      turns: turnsForAi,
      maxQuestions: sessionMaxQuestions(session),
    });

    if (next.action === "finish" || !next.question) {
      // Kesimpulan best-effort — kegagalan AI tidak boleh menggantung sesi.
      let summary: unknown = null;
      let summaryModel: string | null = null;
      try {
        const s = await summarizeInterview({
          candidateName: session.candidate_name,
          positionTitle: session.position_title,
          turns: turnsForAi,
        });
        summary = s.result;
        summaryModel = s.model;
      } catch (e) {
        console.error("[interview-answer] summarize failed:", e);
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE recruitment.interview_ai_sessions
           SET status = 'completed', completed_at = now(),
               ai_summary = $2, summary_model = $3,
               summarized_at = CASE WHEN $2::jsonb IS NULL THEN NULL ELSE now() END
           WHERE id = $1`,
          [session.id, summary ? JSON.stringify(summary) : null, summaryModel]
        );
        await client.query(
          `INSERT INTO recruitment.candidate_activities
             (candidate_id, activity_type, description)
           VALUES ($1, 'interview_ai_completed', $2)`,
          [
            session.candidate_id,
            `Interview AI selesai (${turns.length} pertanyaan)${summary ? " — kesimpulan AI tersedia" : ""}`,
          ]
        );
      });

      return NextResponse.json({ data: { done: true } });
    }

    // Pertanyaan berikutnya (+ TTS best-effort).
    const ttsBuffer = await synthesizeInterviewSpeech(next.question);
    let nextAudioPath: string | null = null;
    if (ttsBuffer) {
      const saved = await savePrivateAudio(ttsBuffer, `interview/${session.id}/questions`);
      nextAudioPath = saved.path;
    }

    const nextTurn = await queryOne<InterviewTurnRow>(
      `INSERT INTO recruitment.interview_ai_turns
         (session_id, turn_no, topic, question, question_audio_path)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, turn_no) DO NOTHING
       RETURNING id, session_id, turn_no, topic, question, question_audio_path,
                 answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at`,
      [session.id, updated.turn_no + 1, next.topic, next.question, nextAudioPath]
    );
    if (!nextTurn) {
      // Race dgn request paralel — kembalikan turn aktif yang sudah dibuat.
      const existing = await queryOne<InterviewTurnRow>(
        `SELECT id, session_id, turn_no, topic, question, question_audio_path,
                answer_audio_path, answer_transcript, answer_mode, asked_at, answered_at
         FROM recruitment.interview_ai_turns
         WHERE session_id = $1 AND answered_at IS NULL
         ORDER BY turn_no LIMIT 1`,
        [session.id]
      );
      return NextResponse.json({
        data: {
          done: false,
          turn: existing
            ? { ...sanitizeTurnForCandidate(existing), question_audio_base64: null }
            : null,
        },
      });
    }

    return NextResponse.json({
      data: {
        done: false,
        turn: {
          ...sanitizeTurnForCandidate(nextTurn),
          question_audio_base64: ttsBuffer ? ttsBuffer.toString("base64") : null,
        },
      },
    });
  } catch (error) {
    console.error("[interview-answer] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
