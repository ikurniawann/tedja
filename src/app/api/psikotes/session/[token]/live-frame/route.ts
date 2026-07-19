import { NextRequest, NextResponse } from "next/server";
import {
  loadSessionByToken,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  bodyTooLarge,
  payloadTooLargeResponse,
} from "@/lib/recruitment/psikotes-session";
import { handleLiveFrame } from "@/lib/recruitment/live-monitor";

/** POST /api/psikotes/session/[token]/live-frame — frame near-live utk Live Monitoring HRD. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (bodyTooLarge(req, 1024 * 1024)) return payloadTooLargeResponse();
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "frame")) return rateLimitedResponse();
    return await handleLiveFrame(req, "psikotes", {
      id: session.id,
      candidate_name: session.candidate_name,
      status: session.status,
    });
  } catch (error) {
    console.error("[psikotes-live-frame] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
