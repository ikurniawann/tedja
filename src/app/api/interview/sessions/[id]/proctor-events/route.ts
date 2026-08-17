import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/interview/sessions/[id]/proctor-events — arsip bukti proctoring
 * satu sesi interview utk HR: flag perilaku (tab/wajah/kamera) + snapshot
 * webcam (path disajikan via /api/interview/files yang ber-auth).
 */

const READ_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_EVENTS = 1000;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID sesi tidak valid" }, { status: 400 });
    }

    const session = await queryOne<{ id: string }>(
      "SELECT id FROM recruitment.interview_ai_sessions WHERE id = $1",
      [id]
    );
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
    }

    const events = await query(
      `SELECT id, event_type, meta, storage_path, created_at
       FROM recruitment.interview_ai_proctor_events
       WHERE session_id = $1
       ORDER BY created_at
       LIMIT ${MAX_EVENTS}`,
      [id]
    );

    return NextResponse.json({ data: events });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[interview-proctor-events] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
