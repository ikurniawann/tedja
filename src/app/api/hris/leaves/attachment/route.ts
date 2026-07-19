import { NextRequest, NextResponse } from "next/server";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { savePrivateImage } from "@/lib/storage-private";

/**
 * POST /api/hris/leaves/attachment — upload lampiran pengajuan cuti (foto
 * surat dokter dsb., JPG/PNG/WebP maks 5 MB) ke storage private. Return path
 * untuk disimpan di leaves.attachment_url; file disajikan via
 * GET /api/hris/leaves/attachment/[...path] (ber-auth).
 * HR boleh meng-upload atas nama karyawan lain (employee_id di body).
 */

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { photo?: string; employee_id?: string };
    const ownerId =
      actor.isHr && body.employee_id ? body.employee_id : actor.employeeId;
    if (!ownerId) {
      return NextResponse.json(
        { error: "Akun ini tidak terhubung ke data karyawan" },
        { status: 403 }
      );
    }

    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.photo ?? "");
    if (!match) {
      return NextResponse.json(
        { error: "Lampiran harus berupa gambar JPG/PNG/WebP" },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran lampiran maksimal 5 MB" }, { status: 400 });
    }

    const saved = await savePrivateImage(buffer, match[1], `leave-attachments/${ownerId}`);
    if (!saved.path) {
      return NextResponse.json(
        { error: saved.error ?? "Gagal menyimpan lampiran" },
        { status: 400 }
      );
    }

    return NextResponse.json({ data: { path: saved.path }, message: "Lampiran tersimpan" });
  } catch (error) {
    console.error("[leaves/attachment] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
