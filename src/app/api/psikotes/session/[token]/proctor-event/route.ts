import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { proctorEventSchema } from "@/lib/validations/psikotes";
import { savePrivateImage, sniffImageMime } from "@/lib/storage-private";
import {
  loadSessionByToken,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  bodyTooLarge,
  payloadTooLargeResponse,
  MAX_SNAPSHOTS_PER_SESSION,
} from "@/lib/recruitment/psikotes-session";

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * POST /api/psikotes/session/[token]/proctor-event — rekam flag proctoring
 * (tab_blur / fullscreen_exit / paste / disconnect) dan snapshot webcam
 * berkala. Snapshot hanya diterima bila kandidat memberi consent kamera;
 * disimpan di storage PRIVATE.
 */

interface RouteParams {
  params: Promise<{ token: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token } = await params;
    if (bodyTooLarge(req, MAX_BODY_BYTES)) return payloadTooLargeResponse();
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "proctor")) return rateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi tidak sedang berjalan" }, { status: 409 });
    }

    const body = await req.json().catch(() => null);
    const parsed = proctorEventSchema.safeParse(body);
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
      if (!session.webcam_consent) {
        return NextResponse.json({ error: "Consent kamera tidak diberikan" }, { status: 400 });
      }
      if (!input.snapshot) {
        return NextResponse.json({ error: "Snapshot kosong" }, { status: 400 });
      }
      // kuota storage per sesi (temuan review: disk-fill DoS)
      const count = await queryOne<{ n: number }>(
        `SELECT count(*)::int AS n FROM recruitment.psikotes_proctor_events
         WHERE session_id = $1 AND event_type = 'webcam_snapshot'`,
        [session.id]
      );
      if ((count?.n ?? 0) >= MAX_SNAPSHOTS_PER_SESSION) {
        return NextResponse.json({ error: "Kuota snapshot sesi tercapai" }, { status: 429 });
      }
      const [head, base64] = input.snapshot.split(",", 2);
      const mime = head.slice("data:".length, head.indexOf(";"));
      const buffer = Buffer.from(base64, "base64");
      if (!sniffImageMime(buffer)) {
        return NextResponse.json({ error: "Isi snapshot bukan gambar valid" }, { status: 400 });
      }
      const saved = await savePrivateImage(buffer, mime, `psikotes/${session.id}/proctor`);
      if (!saved.path) {
        return NextResponse.json({ error: saved.error ?? "Gagal menyimpan snapshot" }, { status: 500 });
      }
      storagePath = saved.path;
    }

    const created = await queryOne(
      `INSERT INTO recruitment.psikotes_proctor_events
         (session_id, event_type, meta, storage_path)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_type, created_at`,
      [session.id, input.event_type, input.meta ? JSON.stringify(input.meta) : null, storagePath]
    );

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    console.error("[psikotes-proctor-event] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
