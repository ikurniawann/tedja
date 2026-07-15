import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { sessionStartSchema } from "@/lib/validations/psikotes";
import {
  loadSessionByToken,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  bodyTooLarge,
  payloadTooLargeResponse,
} from "@/lib/recruitment/psikotes-session";

/**
 * POST /api/psikotes/session/[token]/start — kandidat memulai sesi:
 * merekam consent kamera dan mengubah status draft/sent → in_progress.
 * Idempoten: sesi yang sudah in_progress hanya memperbarui consent.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    if (bodyTooLarge(req, 10_000)) return payloadTooLargeResponse();
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "start")) return rateLimitedResponse();

    if (session.status === "expired") {
      return NextResponse.json({ error: "Link tes sudah kedaluwarsa" }, { status: 410 });
    }
    if (session.status === "completed") {
      return NextResponse.json({ error: "Sesi tes sudah selesai" }, { status: 409 });
    }

    const body = await req.json().catch(() => null);
    const parsed = sessionStartSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    }

    const updated = await queryOne(
      `UPDATE recruitment.psikotes_sessions SET
         status = 'in_progress',
         webcam_consent = $2,
         started_at = COALESCE(started_at, now())
       WHERE id = $1
       RETURNING id, status, webcam_consent, started_at`,
      [session.id, parsed.data.webcam_consent]
    );

    return NextResponse.json({ data: updated, message: "Sesi dimulai" });
  } catch (error) {
    console.error("[psikotes-session-start] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
