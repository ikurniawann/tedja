import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import {
  savePrivateImage,
  deletePrivateFile,
  isAllowedImageMime,
  sniffImageMime,
} from "@/lib/storage-private";
import {
  loadSessionByToken,
  loadSessionTest,
  invalidTokenResponse,
  rateLimitedResponse,
  sessionRateLimited,
  bodyTooLarge,
  payloadTooLargeResponse,
  testDeadlineMs,
  ANSWER_GRACE_MS,
} from "@/lib/recruitment/psikotes-session";

/**
 * POST /api/psikotes/session/[token]/tests/[testId]/upload — unggah hasil
 * gambar tes proyektif (multipart, field "file"). Disimpan di storage
 * PRIVATE (bukan /api/files yang publik); HR mengakses via
 * /api/psikotes/files (ber-auth). Upload ulang menimpa path (selama tes
 * masih in_progress).
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

interface RouteParams {
  params: Promise<{ token: string; testId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { token, testId } = await params;
    // tolak sebelum formData() mem-buffer body besar (temuan review DoS);
    // +1MB utk overhead multipart
    if (bodyTooLarge(req, MAX_UPLOAD_BYTES + 1024 * 1024)) return payloadTooLargeResponse();
    const session = await loadSessionByToken(token);
    if (!session) return invalidTokenResponse();
    if (sessionRateLimited(session.id, "upload")) return rateLimitedResponse();
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Sesi sudah berakhir" }, { status: 409 });
    }

    const test = await loadSessionTest(session.id, testId);
    if (!test) return NextResponse.json({ error: "Tes tidak ditemukan" }, { status: 404 });
    if (test.instrument_kind !== "drawing") {
      return NextResponse.json({ error: "Tes ini tidak menerima unggahan gambar" }, { status: 400 });
    }
    if (test.status !== "in_progress") {
      return NextResponse.json({ error: "Tes tidak sedang berjalan" }, { status: 409 });
    }
    const deadline = testDeadlineMs(test);
    if (deadline && Date.now() > deadline + ANSWER_GRACE_MS) {
      return NextResponse.json({ error: "Waktu tes sudah habis" }, { status: 409 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File tidak ditemukan di form" }, { status: 400 });
    }
    if (!isAllowedImageMime(file.type)) {
      return NextResponse.json({ error: "Format harus JPG, PNG, atau WebP" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimal 8MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // MIME klaim client bisa dipalsukan — isi byte yang menentukan
    if (!sniffImageMime(buffer)) {
      return NextResponse.json(
        { error: "Isi file bukan gambar JPG/PNG/WebP yang valid" },
        { status: 400 }
      );
    }
    const saved = await savePrivateImage(buffer, file.type, `psikotes/${session.id}/${test.id}`);
    if (!saved.path) {
      return NextResponse.json({ error: saved.error ?? "Gagal menyimpan file" }, { status: 500 });
    }

    const replaced = await queryOne<{ id: string }>(
      `UPDATE recruitment.psikotes_session_tests SET attachment_path = $2
       WHERE id = $1 AND status = 'in_progress' RETURNING id`,
      [test.id, saved.path]
    );
    if (!replaced) {
      await deletePrivateFile(saved.path);
      return NextResponse.json({ error: "Tes tidak sedang berjalan" }, { status: 409 });
    }
    // re-upload: file lama tidak boleh jadi yatim di disk (temuan review)
    if (test.attachment_path && test.attachment_path !== saved.path) {
      await deletePrivateFile(test.attachment_path);
    }

    return NextResponse.json({ data: { uploaded: true }, message: "Gambar terunggah" });
  } catch (error) {
    console.error("[psikotes-test-upload] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
