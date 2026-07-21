import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

// Ekstensi yang boleh disajikan; di luar ini → octet-stream + attachment
// (jangan pernah biarkan browser me-render html/svg dari origin app).
const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Penyaji file upload. URL bersifat capability (nama file mengandung
 * komponen acak dari uploadFile) — akses anonim ke URL persis diizinkan
 * karena dipakai lintas konteks sesi (dashboard, portal member, halaman
 * publik). Yang WAJIB: containment path (hasil security review — dulunya
 * bisa traversal keluar storage/uploads) dan nosniff.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  try {
    const { bucket, path: segments } = await params;
    const rel = segments.map(decodeURIComponent).join("/");

    // Containment: hasil resolve HARUS tetap di dalam UPLOAD_ROOT
    const abs = path.resolve(UPLOAD_ROOT, bucket, rel);
    if (!abs.startsWith(UPLOAD_ROOT + path.sep)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    // Tolak segmen mencurigakan (dotfiles / traversal sisa decode)
    if (
      bucket.includes("..") ||
      bucket.includes("/") ||
      bucket.includes("\\") ||
      segments.some((s) => {
        const decoded = decodeURIComponent(s);
        return decoded.includes("..") || decoded.startsWith(".");
      })
    ) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const data = await fs.readFile(abs);
    const ext = path.extname(rel).slice(1).toLowerCase();
    const type = CONTENT_TYPES[ext];
    return new NextResponse(data, {
      headers: {
        "Content-Type": type ?? "application/octet-stream",
        // Paksa unduh utk tipe tak dikenal — anti stored-XSS via svg/html
        ...(type ? {} : { "Content-Disposition": "attachment" }),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
