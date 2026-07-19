import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/psikotes/session-tests/[id]/answers — rincian soal + jawaban
 * kandidat utk HR (MCQ & PAPI). Kunci jawaban boleh tampil di sini karena
 * endpoint ini ber-auth role HR — berbeda dgn endpoint publik kandidat
 * (/api/psikotes/session/[token]) yang tidak pernah men-select answer_key.
 * Urutan MCQ mengikuti snapshot score_detail.per_question supaya riwayat
 * tetap utuh walau bank soal berubah; soal yang sudah dihapus → body null.
 */

const READ_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TestRow {
  id: string;
  status: string;
  answers: Record<string, string> | null;
  score_detail: {
    per_question?: { id: string; given: string | null; correct_key: string; is_correct: boolean }[];
  } | null;
  instrument_id: string;
  instrument_kind: "mcq" | "forced_choice" | "drawing";
}

interface QuestionRow {
  id: string;
  body: string | null;
  options: unknown;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiRole([...READ_ROLES]);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tes tidak valid" }, { status: 400 });
    }

    const test = await queryOne<TestRow>(
      `SELECT t.id, t.status, t.answers, t.score_detail, t.instrument_id,
              i.kind AS instrument_kind
       FROM recruitment.psikotes_session_tests t
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       WHERE t.id = $1`,
      [id]
    );
    if (!test) {
      return NextResponse.json({ error: "Tes tidak ditemukan" }, { status: 404 });
    }
    if (test.instrument_kind === "drawing") {
      return NextResponse.json(
        { error: "Tes gambar tidak memiliki rincian soal" },
        { status: 400 }
      );
    }

    if (test.instrument_kind === "mcq") {
      const perQuestion = test.score_detail?.per_question ?? [];
      if (perQuestion.length === 0) {
        return NextResponse.json({ data: { kind: "mcq", items: [] } });
      }
      const rows = await query<QuestionRow>(
        `SELECT id, body, options
         FROM recruitment.psikotes_questions
         WHERE id = ANY($1::uuid[])`,
        [perQuestion.map((p) => p.id)]
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      const items = perQuestion.map((p) => ({
        id: p.id,
        body: byId.get(p.id)?.body ?? null,
        options: byId.get(p.id)?.options ?? null,
        given: p.given,
        correct_key: p.correct_key,
        is_correct: p.is_correct,
      }));
      return NextResponse.json({ data: { kind: "mcq", items } });
    }

    // forced_choice (PAPI): tampilkan seluruh pasangan aktif urut bank soal.
    const answers = test.answers ?? {};
    const rows = await query<QuestionRow>(
      `SELECT id, body, options
       FROM recruitment.psikotes_questions
       WHERE instrument_id = $1 AND is_active = true
       ORDER BY sort_order, created_at`,
      [test.instrument_id]
    );
    const items = rows.map((r) => {
      const given = answers[r.id];
      return {
        id: r.id,
        body: r.body,
        options: r.options ?? null,
        given: given === "a" || given === "b" ? given : null,
      };
    });
    return NextResponse.json({ data: { kind: "forced_choice", items } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-test-answers] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
