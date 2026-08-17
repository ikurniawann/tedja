import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { mcqQuestionSchema, papiQuestionSchema } from "@/lib/validations/psikotes";

/**
 * Bank soal per instrumen (halaman manajemen — role-gated).
 * GET  /api/psikotes/instruments/[id]/questions — semua soal, TERMASUK kunci
 *      jawaban. Endpoint kandidat (TG3) terpisah dan tidak boleh menyentuh
 *      `answer_key`.
 * POST /api/psikotes/instruments/[id]/questions — tambah soal; skema validasi
 *      mengikuti `kind` instrumen; instrumen `drawing` tidak punya bank soal.
 */

const READ_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const WRITE_ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUESTION_FIELDS =
  "id, instrument_id, body, options, answer_key, sort_order, is_active, created_at, updated_at";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID instrumen tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`psikotes_questions_get_${user.id}`).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }
    const instrument = await queryOne<{ id: string }>(
      "SELECT id FROM recruitment.psikotes_instruments WHERE id = $1",
      [id]
    );
    if (!instrument) {
      return NextResponse.json({ error: "Instrumen tidak ditemukan" }, { status: 404 });
    }
    const rows = await query(
      `SELECT ${QUESTION_FIELDS} FROM recruitment.psikotes_questions
       WHERE instrument_id = $1
       ORDER BY sort_order, created_at`,
      [id]
    );
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-questions] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID instrumen tidak valid" }, { status: 400 });
    }

    // key ke user.id — X-Forwarded-For bisa dipalsukan client
    const rateLimit = checkRateLimit(`psikotes_question_post_${user.id}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const instrument = await queryOne<{ id: string; kind: string }>(
      "SELECT id, kind FROM recruitment.psikotes_instruments WHERE id = $1",
      [id]
    );
    if (!instrument) {
      return NextResponse.json({ error: "Instrumen tidak ditemukan" }, { status: 404 });
    }
    if (instrument.kind === "drawing") {
      return NextResponse.json(
        { error: "Instrumen tes gambar tidak memiliki bank soal — atur instruksi di config" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const schema = instrument.kind === "mcq" ? mcqQuestionSchema : papiQuestionSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid" },
        { status: 400 }
      );
    }
    const input = parsed.data;
    const answerKey = "answer_key" in input ? input.answer_key : null;

    const created = await queryOne(
      `INSERT INTO recruitment.psikotes_questions
         (instrument_id, body, options, answer_key, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${QUESTION_FIELDS}`,
      [
        id,
        input.body,
        JSON.stringify(input.options),
        answerKey ? JSON.stringify(answerKey) : null,
        input.sort_order,
        input.is_active,
      ]
    );

    return NextResponse.json({ data: created, message: "Soal tersimpan" }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-questions] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
