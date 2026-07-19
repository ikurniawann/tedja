import { NextRequest, NextResponse } from "next/server";
import {
  loadInterviewSessionByToken,
  invalidInterviewTokenResponse,
  interviewRateLimitedResponse,
  interviewSessionRateLimited,
} from "@/lib/recruitment/interview-session";
import { appendPrivateChunk } from "@/lib/storage-private";

/**
 * POST /api/interview/session/[token]/recording-chunk — potongan rekaman
 * video interview (MediaRecorder webm, timeslice 10 dtk) di-append ke file
 * part per sesi rekam. multipart: chunk (Blob), part (id part — reload
 * halaman memulai part baru supaya header webm tetap valid).
 * Rekaman diputar HRD via /api/interview/files (ber-auth role).
 */

const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** Kuota per part (~2 jam pada ~500 kbps). */
const MAX_PART_BYTES = 400 * 1024 * 1024;
const PART_RE = /^[0-9]{10,16}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const len = Number(req.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_CHUNK_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Chunk terlalu besar" }, { status: 413 });
    }
    const session = await loadInterviewSessionByToken(token);
    if (!session) return invalidInterviewTokenResponse();
    if (interviewSessionRateLimited(session.id, "recording")) {
      return interviewRateLimitedResponse();
    }
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 409 });
    }

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    const part = String(form.get("part") ?? "");
    const chunk = form.get("chunk");
    if (!PART_RE.test(part) || !(chunk instanceof File) || chunk.size === 0) {
      return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
    }
    if (chunk.size > MAX_CHUNK_BYTES) {
      return NextResponse.json({ error: "Chunk terlalu besar" }, { status: 413 });
    }

    const buffer = Buffer.from(await chunk.arrayBuffer());
    const rel = `interview/${session.id}/recording/part-${part}.webm`;
    const saved = await appendPrivateChunk(rel, buffer, MAX_PART_BYTES);
    if (saved.error) {
      const status = saved.error.includes("Kuota") ? 429 : 400;
      return NextResponse.json({ error: saved.error }, { status });
    }
    return NextResponse.json({ data: { ok: true, size: saved.size } });
  } catch (error) {
    console.error("[interview-recording-chunk] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
