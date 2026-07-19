import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { psikotesReviewSchema } from "@/lib/validations/psikotes";

/**
 * PUT /api/psikotes/session-tests/[id]/review — review manual HR utk tes
 * proyektif (Baum/DAP/Wartegg): simpan kesimpulan + tandai `reviewed`.
 * Reviewer terekam; jejak aktivitas ditulis dalam transaksi yang sama.
 */

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ALLOWED_ROLES]);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tes tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`psikotes_review_put_${user.id}`).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = psikotesReviewSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid" },
        { status: 400 }
      );
    }

    const test = await queryOne<{
      id: string;
      status: string;
      candidate_id: string;
      instrument_name: string;
    }>(
      `SELECT t.id, t.status, s.candidate_id, i.name AS instrument_name
       FROM recruitment.psikotes_session_tests t
       JOIN recruitment.psikotes_sessions s ON s.id = t.session_id
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       WHERE t.id = $1`,
      [id]
    );
    if (!test) {
      return NextResponse.json({ error: "Tes tidak ditemukan" }, { status: 404 });
    }
    if (test.status !== "perlu_review" && test.status !== "reviewed") {
      return NextResponse.json(
        { error: "Tes ini tidak dalam antrian review manual" },
        { status: 409 }
      );
    }

    const saved = await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE recruitment.psikotes_session_tests SET
           status = 'reviewed',
           review_notes = $2,
           reviewed_by = $3,
           reviewed_by_name = $4
         WHERE id = $1
         RETURNING id, status, review_notes, reviewed_by_name`,
        [id, parsed.data.review_notes, user.id, user.full_name]
      );
      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description, created_by, created_by_name)
         VALUES ($1, 'psikotes_reviewed', $2, $3, $4)`,
        [test.candidate_id, `Hasil tes ${test.instrument_name} direview manual`, user.id, user.full_name]
      );
      return res.rows[0];
    });

    return NextResponse.json({ data: saved, message: "Review tersimpan" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-review] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
