import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { listPrivateFiles } from "@/lib/storage-private";

/**
 * GET /api/interview/sessions/[id]/recordings — daftar rekaman video satu
 * sesi interview utk HRD/Super Admin. File diputar via /api/interview/files.
 */

const READ_ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiRole([...READ_ROLES]);
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
    const files = await listPrivateFiles(`interview/${id}/recording`);
    return NextResponse.json({
      data: files.map((f) => ({
        path: `interview/${id}/recording/${f.name}`,
        size: f.size,
        modified_at: f.modified_at,
      })),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[interview-recordings] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
