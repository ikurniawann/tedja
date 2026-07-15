import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { psikotesSummarySchema } from "@/lib/validations/psikotes";

/**
 * PUT /api/candidates/[id]/psikotes/summary — rekomendasi keseluruhan
 * psikotes (1 baris/kandidat, upsert; pola candidate_screenings task 7).
 * Upsert + jejak aktivitas dalam SATU transaksi supaya "tersimpan" selalu
 * berarti "teraudit". Menjadi gate tombol "Lolos → Interview".
 */

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RECOMMENDATION_LABELS: Record<string, string> = {
  lolos: "Lolos",
  hold: "Hold",
  tidak_lolos: "Tidak Lolos",
};

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ALLOWED_ROLES]);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kandidat tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`psikotes_summary_put_${user.id}`).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = psikotesSummarySchema.safeParse(body);
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
        `INSERT INTO recruitment.candidate_psikotes_summary
           (candidate_id, recommendation, notes, updated_by, updated_by_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (candidate_id) DO UPDATE SET
           recommendation  = EXCLUDED.recommendation,
           notes           = EXCLUDED.notes,
           updated_by      = EXCLUDED.updated_by,
           updated_by_name = EXCLUDED.updated_by_name,
           updated_at      = now()
         RETURNING id, candidate_id, recommendation, notes, updated_by, updated_by_name,
                   created_at, updated_at`,
        [id, input.recommendation, input.notes, user.id, user.full_name]
      );
      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description, created_by, created_by_name)
         VALUES ($1, 'psikotes_summary_updated', $2, $3, $4)`,
        [id, `Rekomendasi psikotes disimpan${recLabel}`, user.id, user.full_name]
      );
      return res.rows[0];
    });

    return NextResponse.json({ data: saved, message: "Rekomendasi psikotes tersimpan" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-psikotes-summary] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
