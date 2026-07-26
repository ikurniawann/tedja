import { NextRequest, NextResponse } from "next/server";
import { requireCrmConfigRole } from "@/lib/crm/server";
import { sniffImageMime } from "@/lib/storage-private";
import { uploadFile } from "@/lib/storage";

/**
 * Upload artwork collectible oleh admin (EPIC-014 Task 3) — menggantikan
 * keharusan menghosting gambar sendiri lalu menempel URL. Disimpan ke bucket
 * publik karena artwork memang tampil ke member di portal.
 */
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const denied = await requireCrmConfigRole();
  if (denied) return denied;

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ success: false, error: "Pilih file gambar dulu" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: "Gambar maksimal 5 MB" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    // Isi buffer yang menentukan, bukan MIME klaim browser.
    if (!sniffImageMime(buffer)) {
      return NextResponse.json(
        { success: false, error: "File harus gambar JPG/PNG/WebP" },
        { status: 400 }
      );
    }

    const { url, error } = await uploadFile("crm-avatars", file);
    if (error || !url) {
      return NextResponse.json({ success: false, error: error || "Upload gagal" }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { url } });
  } catch (error) {
    console.error("Error uploading avatar artwork:", error);
    return NextResponse.json({ success: false, error: "Upload gagal" }, { status: 500 });
  }
}
