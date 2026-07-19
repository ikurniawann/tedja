import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { interviewSessionCreateSchema } from "@/lib/validations/interview";

/**
 * POST /api/candidates/[id]/interview/sessions — buat undangan interview AI:
 * generate token 256-bit, baris sesi (status 'sent') + jejak aktivitas
 * dalam satu transaksi. Kandidat mengakses portal /interview/[token].
 */

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ALLOWED_ROLES]);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kandidat tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`interview_session_create_${user.id}`, 20).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = interviewSessionCreateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const candidate = await queryOne<{ id: string }>(
      "SELECT id FROM recruitment.candidates WHERE id = $1",
      [id]
    );
    if (!candidate) {
      return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
    }

    const token = crypto.randomBytes(32).toString("hex");

    const session = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO recruitment.interview_ai_sessions
           (candidate_id, token, status, config, invited_at, expires_at, created_by, created_by_name)
         VALUES ($1, $2, 'sent', $3, now(), now() + make_interval(days => $4), $5, $6)
         RETURNING id, token, status, invited_at, expires_at`,
        [
          id,
          token,
          JSON.stringify({ max_questions: input.max_questions }),
          input.expires_days,
          user.id,
          user.full_name,
        ]
      );
      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description, created_by, created_by_name)
         VALUES ($1, 'interview_ai_invited', $2, $3, $4)`,
        [
          id,
          `Undangan interview AI dibuat (maks ${input.max_questions} pertanyaan; berlaku ${input.expires_days} hari)`,
          user.id,
          user.full_name,
        ]
      );
      return res.rows[0];
    });

    return NextResponse.json({ data: session, message: "Undangan interview dibuat" }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-interview-sessions] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
