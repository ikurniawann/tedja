import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import {
  putOffer,
  getAnswer,
  isValidSdp,
  type LiveSessionType,
} from "@/lib/recruitment/webrtc-signaling";

/**
 * Signaling WebRTC sisi HRD:
 * POST /api/recruitment/live-monitoring/[type]/[id]/webrtc  {offer_id, sdp}
 * GET  ...?offer_id=xxx → {sdp: answer|null}
 */

const MONITOR_ROLES = ["super_admin", "admin", "hrd"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFER_ID_RE = /^[a-z0-9-]{8,64}$/i;

async function sessionExists(type: string, id: string): Promise<boolean> {
  if ((type !== "psikotes" && type !== "interview") || !UUID_RE.test(id)) return false;
  const table =
    type === "psikotes" ? "recruitment.psikotes_sessions" : "recruitment.interview_ai_sessions";
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE id = $1 AND status = 'in_progress'`,
    [id]
  );
  return Boolean(row);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    await requireApiRole([...MONITOR_ROLES]);
    const { type, id } = await params;
    if (!(await sessionExists(type, id))) {
      return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 404 });
    }
    const body = await req.json().catch(() => null);
    const offerId = (body as { offer_id?: unknown })?.offer_id;
    const sdp = (body as { sdp?: unknown })?.sdp;
    if (typeof offerId !== "string" || !OFFER_ID_RE.test(offerId) || !isValidSdp(sdp)) {
      return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    }
    putOffer(type as LiveSessionType, id, offerId, sdp);
    return NextResponse.json({ data: { ok: true } }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[live-webrtc] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    await requireApiRole([...MONITOR_ROLES]);
    const { type, id } = await params;
    if ((type !== "psikotes" && type !== "interview") || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Sesi tidak valid" }, { status: 400 });
    }
    const offerId = req.nextUrl.searchParams.get("offer_id") ?? "";
    if (!OFFER_ID_RE.test(offerId)) {
      return NextResponse.json({ error: "offer_id tidak valid" }, { status: 400 });
    }
    const sdp = getAnswer(type as LiveSessionType, id, offerId);
    return NextResponse.json({ data: { sdp } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[live-webrtc] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
