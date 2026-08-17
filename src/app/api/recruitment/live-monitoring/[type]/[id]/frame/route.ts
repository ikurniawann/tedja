import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";

/**
 * GET /api/recruitment/live-monitoring/[type]/[id]/frame — frame webcam
 * terbaru satu sesi (image/jpeg, no-store) — dipoll HR sbg "live cam".
 */

const MONITOR_ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { type, id } = await params;
    if ((type !== "psikotes" && type !== "interview") || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 400 });
    }

    const frame = await queryOne<{ frame_base64: string; updated_at: string }>(
      `SELECT frame_base64, updated_at FROM recruitment.live_monitor_frames
       WHERE session_type = $1 AND session_id = $2`,
      [type, id]
    );
    if (!frame) {
      return NextResponse.json({ error: "Belum ada frame" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(Buffer.from(frame.frame_base64, "base64")), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "X-Frame-Updated-At": frame.updated_at,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[live-monitoring-frame] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
