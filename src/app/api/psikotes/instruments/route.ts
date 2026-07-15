import { NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/psikotes/instruments — daftar instrumen utk halaman manajemen
 * (termasuk nonaktif + jumlah soal di bank). Endpoint kandidat (TG3) terpisah
 * dan hanya melihat instrumen/soal aktif tanpa kunci jawaban.
 *
 * Rate limit di-key ke user.id (bukan X-Forwarded-For yang bisa dipalsukan
 * client) — endpoint ini selalu authenticated.
 */

const READ_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;

export async function GET() {
  try {
    const user = await requireApiRole([...READ_ROLES]);
    if (!checkRateLimit(`psikotes_instruments_get_${user.id}`).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }
    const rows = await query(
      `SELECT i.id, i.code, i.name, i.kind, i.config, i.is_active, i.sort_order,
              i.created_at, i.updated_at,
              count(q.id)::int AS question_count,
              count(q.id) FILTER (WHERE q.is_active)::int AS active_question_count
       FROM recruitment.psikotes_instruments i
       LEFT JOIN recruitment.psikotes_questions q ON q.instrument_id = i.id
       GROUP BY i.id
       ORDER BY i.sort_order, i.name`
    );
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[psikotes-instruments] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
