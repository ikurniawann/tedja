import { NextRequest, NextResponse } from "next/server";
import {
  loadInterviewSessionByToken,
  invalidInterviewTokenResponse,
  interviewRateLimitedResponse,
  interviewSessionRateLimited,
} from "@/lib/recruitment/interview-session";
import { handleCandidateChat } from "@/lib/recruitment/live-monitor";

/** GET/POST /api/interview/session/[token]/chat — live chat kandidat ↔ HRD. */

async function handle(req: NextRequest, params: Promise<{ token: string }>) {
  try {
    const { token } = await params;
    const session = await loadInterviewSessionByToken(token);
    if (!session) return invalidInterviewTokenResponse();
    if (interviewSessionRateLimited(session.id, "chat")) return interviewRateLimitedResponse();
    return await handleCandidateChat(req, "interview", {
      id: session.id,
      candidate_name: session.candidate_name,
      status: session.status,
    });
  } catch (error) {
    console.error("[interview-chat] failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, params);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, params);
}
