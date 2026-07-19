import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  loadSessionByToken,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  sanitizeTestForCandidate,
  type PsikotesSessionTestRow,
} from "@/lib/recruitment/psikotes-session";

/**
 * GET /api/psikotes/session/[token] — ringkasan sesi utk portal kandidat
 * (anonim, identitas = token). Tidak pernah memuat soal/kunci — soal baru
 * dikirim saat tes dimulai via endpoint start per-tes.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "get")) return rateLimitedResponse();

    const tests = await query<PsikotesSessionTestRow>(
      `SELECT t.id, t.session_id, t.instrument_id, t.status, t.answers,
              t.attachment_path, t.sort_order, t.started_at, t.completed_at,
              i.code AS instrument_code, i.name AS instrument_name,
              i.kind AS instrument_kind, i.config AS instrument_config
       FROM recruitment.psikotes_session_tests t
       JOIN recruitment.psikotes_instruments i ON i.id = t.instrument_id
       WHERE t.session_id = $1
       ORDER BY t.sort_order, i.sort_order`,
      [session.id]
    );

    return NextResponse.json({
      data: {
        session: {
          status: session.status,
          candidate_name: session.candidate_name,
          position_title: session.position_title,
          webcam_consent: session.webcam_consent,
          expires_at: session.expires_at,
          started_at: session.started_at,
          completed_at: session.completed_at,
        },
        tests: tests.map(sanitizeTestForCandidate),
      },
    });
  } catch (error) {
    console.error("[psikotes-session] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
