import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { mcqQuestionSchema, papiQuestionSchema } from "@/lib/validations/psikotes";

/**
 * PUT    /api/psikotes/questions/[id] — update soal (validasi per kind instrumen).
 * DELETE /api/psikotes/questions/[id] — hard delete dari bank soal.
 *        Utk sekadar mengecualikan dari undian tanpa menghapus, pakai
 *        `is_active=false` via PUT. Hasil tes historis tidak rusak karena
 *        TG3 menyimpan snapshot yang dibutuhkan di `answers`/`score_detail`.
 */

const WRITE_ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUESTION_FIELDS =
  "id, instrument_id, body, options, answer_key, sort_order, is_active, created_at, updated_at";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// key ke user.id — X-Forwarded-For bisa dipalsukan client
function rateLimited(userId: string, bucket: string) {
  return !checkRateLimit(`${bucket}_${userId}`).allowed;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID soal tidak valid" }, { status: 400 });
    }
    if (rateLimited(user.id, "psikotes_question_put")) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const existing = await queryOne<{ id: string; kind: string }>(
      `SELECT q.id, i.kind
       FROM recruitment.psikotes_questions q
       JOIN recruitment.psikotes_instruments i ON i.id = q.instrument_id
       WHERE q.id = $1`,
      [id]
    );
    if (!existing) {
      return NextResponse.json({ error: "Soal tidak ditemukan" }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const schema = existing.kind === "mcq" ? mcqQuestionSchema : papiQuestionSchema;
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

    const updated = await queryOne(
      `UPDATE recruitment.psikotes_questions SET
         body       = $2,
         options    = $3,
         answer_key = $4,
         sort_order = $5,
         is_active  = $6
       WHERE id = $1
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

    return NextResponse.json({ data: updated, message: "Soal tersimpan" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-question] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID soal tidak valid" }, { status: 400 });
    }
    if (rateLimited(user.id, "psikotes_question_delete")) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const deleted = await queryOne<{ id: string }>(
      "DELETE FROM recruitment.psikotes_questions WHERE id = $1 RETURNING id",
      [id]
    );
    if (!deleted) {
      return NextResponse.json({ error: "Soal tidak ditemukan" }, { status: 404 });
    }

    return NextResponse.json({ data: deleted, message: "Soal dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-question] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
