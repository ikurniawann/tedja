import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { interviewProctorEventSchema } from "@/lib/validations/interview";
import { savePrivateImage, sniffImageMime } from "@/lib/storage-private";
import {
  loadInterviewSessionByToken,
  invalidInterviewTokenResponse,
  interviewRateLimitedResponse,
  interviewSessionRateLimited,
  MAX_INTERVIEW_SNAPSHOTS_PER_SESSION,
} from "@/lib/recruitment/interview-session";

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * POST /api/interview/session/[token]/proctor-event — rekam flag proctoring
 * interview: event psikotes (tab_blur/fullscreen_exit/paste/disconnect/
 * webcam_snapshot) + deteksi wajah (face_not_detected/multiple_faces/
 * camera_off). Snapshot disimpan di storage PRIVATE.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    const len = Number(req.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Ukuran permintaan terlalu besar" }, { status: 413 });
    }
    const session = await loadInterviewSessionByToken(token);
    if (!session) return invalidInterviewTokenResponse();
    if (interviewSessionRateLimited(session.id, "proctor")) return interviewRateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 409 });
    }

    const body = await req.json().catch(() => null);
    const parsed = interviewProctorEventSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    let storagePath: string | null = null;
    if (input.event_type === "webcam_snapshot") {
      if (!input.snapshot) {
        return NextResponse.json({ error: "Snapshot kosong" }, { status: 400 });
      }
      const count = await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM recruitment.interview_ai_proctor_events
         WHERE session_id = $1 AND event_type = 'webcam_snapshot'`,
        [session.id]
      );
      if ((count?.n ?? 0) >= MAX_INTERVIEW_SNAPSHOTS_PER_SESSION) {
        return NextResponse.json({ error: "Kuota snapshot sesi tercapai" }, { status: 429 });
      }
      const [head, base64] = input.snapshot.split(",", 2);
      const mime = head.slice("data:".length, head.indexOf(";"));
      const buffer = Buffer.from(base64, "base64");
      if (!sniffImageMime(buffer)) {
        return NextResponse.json({ error: "Isi snapshot bukan gambar valid" }, { status: 400 });
      }
      const saved = await savePrivateImage(buffer, mime, `interview/${session.id}/proctor`);
      if (!saved.path) {
        return NextResponse.json(
          { error: saved.error ?? "Gagal menyimpan snapshot" },
          { status: 500 }
        );
      }
      storagePath = saved.path;
    }

    await queryOne(
      `INSERT INTO recruitment.interview_ai_proctor_events
         (session_id, event_type, meta, storage_path)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [session.id, input.event_type, input.meta ? JSON.stringify(input.meta) : null, storagePath]
    );

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    console.error("[interview-proctor-event] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
