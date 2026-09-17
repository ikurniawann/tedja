import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

/** "bytes=0-1023" / "bytes=1024-" → {start,end} dalam batas ukuran file. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const hasStart = m[1] !== "";
  const hasEnd = m[2] !== "";
  let start: number;
  let end: number;
  if (hasStart) {
    start = Number(m[1]);
    end = hasEnd ? Number(m[2]) : size - 1;
  } else if (hasEnd) {
    // suffix: N byte terakhir
    const n = Number(m[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    return null;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Penyaji file upload. URL bersifat capability (nama file mengandung
 * komponen acak dari uploadFile) — akses anonim ke URL persis diizinkan
 * karena dipakai lintas konteks sesi (dashboard, portal member, halaman
 * publik). Yang WAJIB: containment path (hasil security review — dulunya
 * bisa traversal keluar storage/uploads) dan nosniff.
 *
 * File di-STREAM (bukan dibaca penuh ke RAM) dan mendukung Range request,
 * supaya file besar / banyak request bersamaan tidak menggelembungkan memori
 * dan media/PDF bisa di-seek (audit performa 2026-09-17).
 */
export async function GET(
  request: Request,
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

    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const ext = path.extname(rel).slice(1).toLowerCase();
    const type = CONTENT_TYPES[ext];
    const baseHeaders: Record<string, string> = {
      "Content-Type": type ?? "application/octet-stream",
      ...(type ? {} : { "Content-Disposition": "attachment" }),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
      "Accept-Ranges": "bytes",
    };

    const range = parseRange(request.headers.get("range"), stat.size);
    if (range) {
      const nodeStream = createReadStream(abs, { start: range.start, end: range.end });
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
      return new NextResponse(webStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
          "Content-Length": String(range.end - range.start + 1),
        },
      });
    }

    const nodeStream = createReadStream(abs);
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
    return new NextResponse(webStream, {
      headers: { ...baseHeaders, "Content-Length": String(stat.size) },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
