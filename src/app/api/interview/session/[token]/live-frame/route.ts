import { NextRequest, NextResponse } from "next/server";
import {
  loadInterviewSessionByToken,
  invalidInterviewTokenResponse,
  interviewRateLimitedResponse,
  interviewSessionRateLimited,
} from "@/lib/recruitment/interview-session";
import { handleLiveFrame } from "@/lib/recruitment/live-monitor";

/** POST /api/interview/session/[token]/live-frame — frame near-live utk Live Monitoring HRD. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const len = Number(req.headers.get("content-length"));
    if (Number.isFinite(len) && len > 1024 * 1024) {
      return NextResponse.json({ error: "Ukuran permintaan terlalu besar" }, { status: 413 });
    }
    const session = await loadInterviewSessionByToken(token);
    if (!session) return invalidInterviewTokenResponse();
    if (interviewSessionRateLimited(session.id, "frame")) return interviewRateLimitedResponse();
    return await handleLiveFrame(req, "interview", {
      id: session.id,
      candidate_name: session.candidate_name,
      status: session.status,
    });
  } catch (error) {
    console.error("[interview-live-frame] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
