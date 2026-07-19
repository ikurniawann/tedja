import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { sessionAnswersSchema } from "@/lib/validations/psikotes";
import {
  loadSessionByToken,
  loadSessionTest,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  testDeadlineMs,
  ANSWER_GRACE_MS,
  bodyTooLarge,
  payloadTooLargeResponse,
} from "@/lib/recruitment/psikotes-session";

const MAX_BODY_BYTES = 100_000;

/**
 * PUT /api/psikotes/session/[token]/tests/[testId]/answers — autosave jawaban.
 * Hanya soal yang memang diundikan utk tes ini yang diterima; penulisan
 * ditolak setelah deadline + grace 30 detik (timer ditegakkan server-side).
 */

interface RouteParams {
  params: Promise<{ token: string; testId: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { token, testId } = await params;
    if (bodyTooLarge(req, MAX_BODY_BYTES)) return payloadTooLargeResponse();
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "answers")) return rateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi sudah berakhir" }, { status: 409 });
    }

    const test = await loadSessionTest(session.id, testId);
    if (!test) return NextResponse.json({ error: "Tes tidak ditemukan" }, { status: 404 });
    if (test.status !== "in_progress") {
      return NextResponse.json({ error: "Tes tidak sedang berjalan" }, { status: 409 });
    }

    const deadline = testDeadlineMs(test);
    if (deadline && Date.now() > deadline + ANSWER_GRACE_MS) {
      return NextResponse.json({ error: "Waktu tes sudah habis" }, { status: 409 });
    }

    const body = await req.json().catch(() => null);
    const parsed = sessionAnswersSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    }

    const allowed = new Set(test.answers?.question_ids ?? []);
    const incoming = Object.fromEntries(
      Object.entries(parsed.data.answers).filter(([qid]) => allowed.has(qid))
    );

    // guard status di UPDATE juga: autosave yang balapan dgn finish tidak
    // boleh menulis ke tes yang sudah terskor (temuan review)
    const updated = await queryOne<{ answers: { answers?: Record<string, string> } }>(
      `UPDATE recruitment.psikotes_session_tests SET
         answers = jsonb_set(answers, '{answers}', COALESCE(answers->'answers', '{}'::jsonb) || $2::jsonb)
       WHERE id = $1 AND status = 'in_progress'
       RETURNING answers`,
      [test.id, JSON.stringify(incoming)]
    );
    if (!updated) {
      return NextResponse.json({ error: "Tes tidak sedang berjalan" }, { status: 409 });
    }

    return NextResponse.json({
      data: { saved: Object.keys(updated?.answers?.answers ?? {}).length },
      message: "Jawaban tersimpan",
    });
  } catch (error) {
    console.error("[psikotes-test-answers] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
