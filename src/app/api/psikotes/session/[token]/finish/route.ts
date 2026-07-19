import { NextRequest, NextResponse } from "next/server";
import { query, withTransaction } from "@/lib/db";
import {
  loadSessionByToken,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
} from "@/lib/recruitment/psikotes-session";

/**
 * POST /api/psikotes/session/[token]/finish — tutup sesi setelah SEMUA tes
 * terminal (selesai/perlu_review/reviewed). Menandai sesi completed dan
 * mencatat jejak 'psikotes_completed' di timeline kandidat (atribusi
 * "Sistem" — dilakukan kandidat, bukan HR) dalam satu transaksi.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "finish")) return rateLimitedResponse();
    if (session.status === "completed") {
      return NextResponse.json({ data: { status: "completed" }, message: "Sesi sudah selesai" });
    }
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 409 });
    }

    const remaining = await query<{ name: string }>(
      `SELECT i.name FROM recruitment.psikotes_session_tests t
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       WHERE t.session_id = $1 AND t.status IN ('pending', 'in_progress')`,
      [session.id]
    );
    if (remaining.length > 0) {
      return NextResponse.json(
        { error: `Masih ada tes yang belum selesai: ${remaining.map((r) => r.name).join(", ")}` },
        { status: 400 }
      );
    }

    // conditional + jejak hanya utk request yang memenangkan transisi —
    // dua finish balapan tidak boleh menulis aktivitas ganda (temuan review)
    const updated = await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE recruitment.psikotes_sessions SET
           status = 'completed', completed_at = now()
         WHERE id = $1 AND status = 'in_progress'
         RETURNING id, status, completed_at`,
        [session.id]
      );
      if (res.rowCount === 0) return null;
      await client.query(
        `INSERT INTO recruitment.candidate_activities
           (candidate_id, activity_type, description, created_by, created_by_name)
         VALUES ($1, 'psikotes_completed', $2, NULL, 'Sistem')`,
        [session.candidate_id, "Kandidat menyelesaikan seluruh rangkaian psikotes online"]
      );
      return res.rows[0];
    });
    if (!updated) {
      return NextResponse.json({ data: { status: "completed" }, message: "Sesi sudah selesai" });
    }

    return NextResponse.json({ data: updated, message: "Seluruh tes selesai — terima kasih" });
  } catch (error) {
    console.error("[psikotes-session-finish] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
