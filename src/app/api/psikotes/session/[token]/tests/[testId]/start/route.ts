import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import {
  loadSessionByToken,
  loadSessionTest,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  sanitizeTestForCandidate,
  testDeadlineMs,
} from "@/lib/recruitment/psikotes-session";

/**
 * POST /api/psikotes/session/[token]/tests/[testId]/start — mulai/lanjutkan
 * satu instrumen:
 * - Undian soal terjadi SEKALI di sini (snapshot `question_ids` di kolom
 *   answers) supaya refresh/resume mendapat set & urutan yang sama.
 * - Soal dikirim TANPA kunci: MCQ tanpa answer_key, PAPI tanpa kode skala.
 * - Tes gambar tidak punya soal — hanya menandai in_progress.
 */

interface RouteParams {
  params: Promise<{ token: string; testId: string }>;
}

interface QuestionRow {
  id: string;
  body: string;
  options: unknown;
}

function sanitizeQuestions(kind: string, rows: QuestionRow[]) {
  if (kind === "forced_choice") {
    return rows.map((q) => {
      const pair = q.options as { a?: { text?: string }; b?: { text?: string } } | null;
      return {
        id: q.id,
        body: q.body,
        options: {
          a: { text: pair?.a?.text ?? "" },
          b: { text: pair?.b?.text ?? "" },
        },
      };
    });
  }
  return rows.map((q) => {
    const opts = Array.isArray(q.options) ? (q.options as { key: string; text: string }[]) : [];
    return { id: q.id, body: q.body, options: opts.map((o) => ({ key: o.key, text: o.text })) };
  });
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const { token, testId } = await params;
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "test_start")) return rateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi belum dimulai atau sudah berakhir" }, { status: 409 });
    }

    let test = await loadSessionTest(session.id, testId);
    if (!test) return NextResponse.json({ error: "Tes tidak ditemukan" }, { status: 404 });
    if (test.status !== "pending" && test.status !== "in_progress") {
      return NextResponse.json({ error: "Tes ini sudah diselesaikan" }, { status: 409 });
    }

    if (test.status === "pending") {
      let questionIds: string[] = [];
      if (test.instrument_kind !== "drawing") {
        const config = test.instrument_config;
        const useShuffle = test.instrument_kind === "mcq" && config.shuffle;
        const limit =
          test.instrument_kind === "mcq" && config.question_count
            ? Math.max(1, config.question_count)
            : null;
        const rows = await query<{ id: string }>(
          `SELECT id FROM recruitment.psikotes_questions
           WHERE instrument_id = $1 AND is_active = true
           ORDER BY ${useShuffle ? "random()" : "sort_order, created_at"}
           ${limit ? "LIMIT $2" : ""}`,
          limit ? [test.instrument_id, limit] : [test.instrument_id]
        );
        questionIds = rows.map((r) => r.id);
        if (questionIds.length === 0) {
          return NextResponse.json(
            { error: "Bank soal instrumen ini kosong — hubungi HR" },
            { status: 409 }
          );
        }
      }
      // conditional pada status: dua request start yang balapan tidak boleh
      // sama-sama mengundi — yang kalah memakai hasil undian pemenang
      await queryOne(
        `UPDATE recruitment.psikotes_session_tests SET
           status = 'in_progress',
           started_at = COALESCE(started_at, now()),
           answers = $2::jsonb
         WHERE id = $1 AND status = 'pending' RETURNING id`,
        [test.id, JSON.stringify({ question_ids: questionIds, answers: {} })]
      );
      test = (await loadSessionTest(session.id, testId))!;
    }

    let questions: ReturnType<typeof sanitizeQuestions> = [];
    const drawnIds = test.answers?.question_ids ?? [];
    if (test.instrument_kind !== "drawing" && drawnIds.length > 0) {
      const rows = await query<QuestionRow>(
        `SELECT id, body, options FROM recruitment.psikotes_questions WHERE id = ANY($1::uuid[])`,
        [drawnIds]
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      questions = sanitizeQuestions(
        test.instrument_kind,
        drawnIds.map((id) => byId.get(id)).filter((r): r is QuestionRow => Boolean(r))
      );
    }

    const deadline = testDeadlineMs(test);
    return NextResponse.json({
      data: {
        test: sanitizeTestForCandidate(test),
        questions,
        saved_answers: test.answers?.answers ?? {},
        ends_at: deadline ? new Date(deadline).toISOString() : null,
      },
    });
  } catch (error) {
    console.error("[psikotes-test-start] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
