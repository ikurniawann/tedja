import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { psikotesSessionCreateSchema } from "@/lib/validations/psikotes";

/**
 * POST /api/candidates/[id]/psikotes/sessions — buat undangan tes baru:
 * generate token 256-bit, baris sesi (status 'sent') + baris tes per
 * instrumen terpilih, dan jejak aktivitas — dalam SATU transaksi.
 */

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kandidat tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`psikotes_session_create_${user.id}`, 20).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = psikotesSessionCreateSchema.safeParse(body);
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

    const instruments = await query<{ id: string; name: string; sort_order: number }>(
      `SELECT id, name, sort_order FROM recruitment.psikotes_instruments
       WHERE id = ANY($1::uuid[]) AND is_active = true
       ORDER BY sort_order`,
      [input.instrument_ids]
    );
    if (instruments.length !== input.instrument_ids.length) {
      return NextResponse.json(
        { error: "Ada instrumen yang tidak ditemukan atau nonaktif" },
        { status: 400 }
      );
    }

    const token = crypto.randomBytes(32).toString("hex");

    const session = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO recruitment.psikotes_sessions
           (candidate_id, token, status, invited_at, expires_at, created_by, created_by_name)
         VALUES ($1, $2, 'sent', now(), now() + make_interval(days => $3), $4, $5)
         RETURNING id, token, status, invited_at, expires_at`,
        [id, token, input.expires_days, user.id, user.full_name]
      );
      const sessionRow = res.rows[0];
      for (const [index, instrument] of instruments.entries()) {
        await client.query(
          `INSERT INTO recruitment.psikotes_session_tests (session_id, instrument_id, sort_order)
           VALUES ($1, $2, $3)`,
          [sessionRow.id, instrument.id, index]
        );
      }
      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description, created_by, created_by_name)
         VALUES ($1, 'psikotes_invited', $2, $3, $4)`,
        [
          id,
          `Undangan psikotes online dibuat (${instruments.map((i) => i.name).join(", ")}; berlaku ${input.expires_days} hari)`,
          user.id,
          user.full_name,
        ]
      );
      return sessionRow;
    });

    return NextResponse.json(
      { data: session, message: "Undangan tes dibuat" },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-psikotes-sessions] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
