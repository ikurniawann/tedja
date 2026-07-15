import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { sessionAnswersSchema } from "@/lib/validations/psikotes";
import { scoreMcq, scorePapi } from "@/lib/recruitment/psikotes-scoring";
import {
  loadSessionByToken,
  loadSessionTest,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  bodyTooLarge,
  payloadTooLargeResponse,
  testDeadlineMs,
  ANSWER_GRACE_MS,
} from "@/lib/recruitment/psikotes-session";

const MAX_BODY_BYTES = 100_000;

/** Row soal utk scoring — jsonb dari DB dinarrow eksplisit, bukan di-cast. */
interface QuestionScoringRow {
  id: string;
  options: unknown;
  answer_key: unknown;
}

function toMcqAnswerKey(value: unknown): { correct: string } | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "correct" in value &&
    typeof (value as { correct: unknown }).correct === "string"
  ) {
    return { correct: (value as { correct: string }).correct };
  }
  return null;
}

function toPapiOptions(value: unknown): { a: { scale: string }; b: { scale: string } } | null {
  if (typeof value !== "object" || value === null) return null;
  const pair = value as { a?: { scale?: unknown }; b?: { scale?: unknown } };
  if (typeof pair.a?.scale === "string" && typeof pair.b?.scale === "string") {
    return { a: { scale: pair.a.scale }, b: { scale: pair.b.scale } };
  }
  return null;
}

/**
 * POST /api/psikotes/session/[token]/tests/[testId]/finish — akhiri satu tes.
 * Body opsional {answers} = flush jawaban terakhir (merge sebelum scoring).
 * - mcq: scoring server-side → score 0–100 + snapshot per soal, status selesai.
 * - forced_choice (PAPI): skor 20 skala + skala dominan (score kolom = null,
 *   tidak ada benar/salah), status selesai.
 * - drawing: wajib sudah upload gambar → status perlu_review (review manual HR).
 * Idempoten: tes yang sudah terminal mengembalikan status saat ini.
 */

interface RouteParams {
  params: Promise<{ token: string; testId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token, testId } = await params;
    if (bodyTooLarge(req, MAX_BODY_BYTES)) return payloadTooLargeResponse();
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "test_finish")) return rateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi sudah berakhir" }, { status: 409 });
    }

    const test = await loadSessionTest(session.id, testId);
    if (!test) return NextResponse.json({ error: "Tes tidak ditemukan" }, { status: 404 });
    if (test.status === "selesai" || test.status === "perlu_review" || test.status === "reviewed") {
      return NextResponse.json({ data: { status: test.status }, message: "Tes sudah selesai" });
    }
    if (test.status !== "in_progress") {
      return NextResponse.json({ error: "Tes belum dimulai" }, { status: 409 });
    }

    // flush jawaban terakhir (opsional) — hindari race dgn autosave terakhir
    const body = await req.json().catch(() => null);
    let finalAnswers = test.answers?.answers ?? {};
    if (body) {
      const parsed = sessionAnswersSchema.safeParse(body);
      if (parsed.success) {
        const allowed = new Set(test.answers?.question_ids ?? []);
        const incoming = Object.fromEntries(
          Object.entries(parsed.data.answers).filter(([qid]) => allowed.has(qid))
        );
        finalAnswers = { ...finalAnswers, ...incoming };
      }
    }

    if (test.instrument_kind === "drawing") {
      // sebelum deadline: wajib upload dulu. Setelah deadline: finish tetap
      // diterima walau tanpa gambar (perlu_review; HR melihat tidak ada
      // lampiran) supaya sesi tidak menggantung selamanya.
      const deadline = testDeadlineMs(test);
      const pastDeadline = deadline !== null && Date.now() > deadline + ANSWER_GRACE_MS;
      if (!test.attachment_path && !pastDeadline) {
        return NextResponse.json(
          { error: "Unggah hasil gambar terlebih dahulu" },
          { status: 400 }
        );
      }
      const updated = await queryOne(
        `UPDATE recruitment.psikotes_session_tests SET
           status = 'perlu_review', completed_at = now()
         WHERE id = $1 AND status = 'in_progress'
         RETURNING id, status, completed_at`,
        [test.id]
      );
      return NextResponse.json({
        data: updated ?? { status: "perlu_review" },
        message: "Tes selesai — menunggu review HR",
      });
    }

    const drawnIds = test.answers?.question_ids ?? [];
    const questions = await query<QuestionScoringRow>(
      `SELECT id, options, answer_key FROM recruitment.psikotes_questions
       WHERE id = ANY($1::uuid[])`,
      [drawnIds]
    );

    let score: number | null = null;
    let scoreDetail: unknown;
    if (test.instrument_kind === "mcq") {
      const result = scoreMcq(
        questions.map((q) => ({ id: q.id, answer_key: toMcqAnswerKey(q.answer_key) })),
        finalAnswers
      );
      score = result.score;
      scoreDetail = result.detail;
    } else {
      scoreDetail = scorePapi(
        questions.map((q) => ({ id: q.id, options: toPapiOptions(q.options) })),
        finalAnswers
      );
    }

    // conditional pada status: dua finish yang balapan → hanya satu yang
    // menulis skor; yang kalah mengembalikan status terkini
    const updated = await queryOne(
      `UPDATE recruitment.psikotes_session_tests SET
         status = 'selesai',
         answers = jsonb_set(answers, '{answers}', $2::jsonb),
         score = $3,
         score_detail = $4::jsonb,
         completed_at = now()
       WHERE id = $1 AND status = 'in_progress'
       RETURNING id, status, score, completed_at`,
      [test.id, JSON.stringify(finalAnswers), score, JSON.stringify(scoreDetail)]
    );

    return NextResponse.json({
      data: updated ?? { id: test.id, status: "selesai" },
      message: "Tes selesai",
    });
  } catch (error) {
    console.error("[psikotes-test-finish] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
