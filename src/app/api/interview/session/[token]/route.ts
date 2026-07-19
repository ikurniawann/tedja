import { NextRequest, NextResponse } from "next/server";
import {
  loadInterviewSessionByToken,
  loadInterviewTurns,
  invalidInterviewTokenResponse,
  interviewRateLimitedResponse,
  interviewSessionRateLimited,
  sanitizeTurnForCandidate,
  sessionMaxQuestions,
} from "@/lib/recruitment/interview-session";
import { readPrivateFile } from "@/lib/storage-private";

/**
 * GET /api/interview/session/[token] — ringkasan sesi utk portal kandidat
 * (anonim, identitas = token). Kesimpulan AI TIDAK pernah dikirim ke
 * kandidat. Audio TTS pertanyaan aktif ikut dikirim (base64) supaya portal
 * bisa memutar ulang suara pertanyaan setelah reload.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const session = await loadInterviewSessionByToken(token);
    if (!session) return invalidInterviewTokenResponse();
    if (interviewSessionRateLimited(session.id, "get")) return interviewRateLimitedResponse();

    const turns = await loadInterviewTurns(session.id);
    const current = turns.find((t) => !t.answered_at) ?? null;

    let currentAudioBase64: string | null = null;
    if (current?.question_audio_path) {
      const { data } = await readPrivateFile(current.question_audio_path);
      if (data) currentAudioBase64 = data.toString("base64");
    }

    return NextResponse.json({
      data: {
        session: {
          status: session.status,
          candidate_name: session.candidate_name,
          position_title: session.position_title,
          webcam_consent: session.webcam_consent,
          max_questions: sessionMaxQuestions(session),
          expires_at: session.expires_at,
          started_at: session.started_at,
          completed_at: session.completed_at,
        },
        turns: turns.map(sanitizeTurnForCandidate),
        current_turn: current
          ? { ...sanitizeTurnForCandidate(current), question_audio_base64: currentAudioBase64 }
          : null,
      },
    });
  } catch (error) {
    console.error("[interview-session] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
