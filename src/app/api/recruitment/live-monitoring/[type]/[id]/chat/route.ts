import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from "@/lib/db";
import {
  fetchChatMessages,
  insertChatMessage,
  type LiveSessionType,
} from "@/lib/recruitment/live-monitor";

/**
 * /api/recruitment/live-monitoring/[type]/[id]/chat — sisi HRD:
 * GET riwayat pesan, POST kirim pesan ke kandidat (sender 'hr').
 */

const MONITOR_ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveSession(type: string, id: string) {
  if ((type !== "psikotes" && type !== "interview") || !UUID_RE.test(id)) return null;
  const table =
    type === "psikotes" ? "recruitment.psikotes_sessions" : "recruitment.interview_ai_sessions";
  return queryOne<{ id: string; status: string; candidate_name: string }>(
    `SELECT s.id, s.status, c.full_name AS candidate_name
     FROM ${table} s JOIN recruitment.candidates c ON c.id = s.candidate_id
     WHERE s.id = $1`,
    [id]
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { type, id } = await params;
    const session = await resolveSession(type, id);
    if (!session) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
    const messages = await fetchChatMessages(
      type as LiveSessionType,
      session.id,
      req.nextUrl.searchParams.get("after")
    );
    return NextResponse.json({ data: messages });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[live-monitoring-chat] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { type, id } = await params;
    const session = await resolveSession(type, id);
    if (!session) return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const message =
      typeof body === "object" && body !== null ? (body as { message?: unknown }).message : null;
    if (typeof message !== "string") {
      return NextResponse.json({ error: "Pesan tidak valid" }, { status: 400 });
    }
    const saved = await insertChatMessage({
      type: type as LiveSessionType,
      sessionId: session.id,
      sender: "hr",
      senderName: user.full_name || "HRD",
      message,
    });
    if (!saved) return NextResponse.json({ error: "Pesan kosong" }, { status: 400 });
    return NextResponse.json({ data: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[live-monitoring-chat] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
