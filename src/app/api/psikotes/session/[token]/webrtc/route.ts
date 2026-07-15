import { NextRequest, NextResponse } from "next/server";
import {
  loadSessionByToken,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
} from "@/lib/recruitment/psikotes-session";
import {
  getPendingOffers,
  putAnswer,
  isValidSdp,
} from "@/lib/recruitment/webrtc-signaling";

/**
 * Signaling WebRTC sisi kandidat (psikotes):
 * GET  /api/psikotes/session/[token]/webrtc → offer pending dari HRD
 * POST {offer_id, sdp} → answer kandidat
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "webrtc")) return rateLimitedResponse();
    if (session.status !== "in_progress") return NextResponse.json({ data: { offers: [] } });
    return NextResponse.json({ data: { offers: getPendingOffers("psikotes", session.id) } });
  } catch (error) {
    console.error("[psikotes-webrtc] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "webrtc")) return rateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 409 });
    }
    const body = await req.json().catch(() => null);
    const offerId = (body as { offer_id?: unknown })?.offer_id;
    const sdp = (body as { sdp?: unknown })?.sdp;
    if (typeof offerId !== "string" || !isValidSdp(sdp)) {
      return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    }
    const ok = putAnswer("psikotes", session.id, offerId, sdp);
    return NextResponse.json({ data: { ok } });
  } catch (error) {
    console.error("[psikotes-webrtc] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
