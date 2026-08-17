import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { screeningSchema } from "@/lib/validations/candidate";

/**
 * Hasil screening call terstruktur, 1 baris per kandidat.
 * GET /api/candidates/[id]/screening — muat hasil (null jika belum ada).
 * PUT /api/candidates/[id]/screening — upsert; upsert + jejak aktivitas ditulis
 * dalam SATU transaksi supaya "tersimpan" selalu berarti "teraudit" (AC epic).
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_FIELDS = `id, candidate_id, contacted, interested, availability_note,
  confirmed_salary::float8 AS confirmed_salary, willing_shift, willing_placement,
  notes, recommendation, updated_by, updated_by_name, created_at, updated_at`;

const RECOMMENDATION_LABELS: Record<string, string> = {
  lolos: "Lolos",
  hold: "Hold",
  tidak_lolos: "Tidak Lolos",
};

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kandidat tidak valid" }, { status: 400 });
    }
    const row = await queryOne(
      `SELECT ${SELECT_FIELDS} FROM recruitment.candidate_screenings WHERE candidate_id = $1`,
      [id]
    );
    return NextResponse.json({ data: row ?? null });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-screening] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kandidat tidak valid" }, { status: 400 });
    }

    const clientIp = req.headers.get("x-forwarded-for") || "anonymous";
    const rateLimit = checkRateLimit(`candidate_screening_put_${clientIp}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = screeningSchema.safeParse(body);
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

    const recLabel = input.recommendation
      ? ` (rekomendasi: ${RECOMMENDATION_LABELS[input.recommendation]})`
      : "";

    const saved = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO recruitment.candidate_screenings
           (candidate_id, contacted, interested, availability_note, confirmed_salary,
            willing_shift, willing_placement, notes, recommendation, updated_by, updated_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (candidate_id) DO UPDATE SET
           contacted = EXCLUDED.contacted,
           interested = EXCLUDED.interested,
           availability_note = EXCLUDED.availability_note,
           confirmed_salary = EXCLUDED.confirmed_salary,
           willing_shift = EXCLUDED.willing_shift,
           willing_placement = EXCLUDED.willing_placement,
           notes = EXCLUDED.notes,
           recommendation = EXCLUDED.recommendation,
           updated_by = EXCLUDED.updated_by,
           updated_by_name = EXCLUDED.updated_by_name,
           updated_at = now()
         RETURNING ${SELECT_FIELDS}`,
        [
          id,
          input.contacted,
          input.interested,
          input.availability_note,
          input.confirmed_salary,
          input.willing_shift,
          input.willing_placement,
          input.notes,
          input.recommendation,
          user.id,
          user.full_name,
        ]
      );

      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description, created_by, created_by_name)
         VALUES ($1, 'screening_updated', $2, $3, $4)`,
        [id, `Hasil screening disimpan${recLabel}`, user.id, user.full_name]
      );

      return res.rows[0];
    });

    return NextResponse.json({ data: saved, message: "Hasil screening tersimpan" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-screening] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
