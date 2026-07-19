import { NextRequest, NextResponse } from "next/server";
import {
  loadSessionByToken,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
} from "@/lib/recruitment/psikotes-session";
import { handleCandidateChat } from "@/lib/recruitment/live-monitor";

/** GET/POST /api/psikotes/session/[token]/chat — live chat kandidat ↔ HRD. */

async function handle(req: NextRequest, params: Promise<{ token: string }>) {
  try {
    const { token } = await params;
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "chat")) return rateLimitedResponse();
    return await handleCandidateChat(req, "psikotes", {
      id: session.id,
      candidate_name: session.candidate_name,
      status: session.status,
    });
  } catch (error) {
    console.error("[psikotes-chat] failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, params);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return handle(req, params);
}
