import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { readPrivateFile } from "@/lib/storage-private";

/**
 * Penyaji arsip nota vendor (storage/private/purchasing-receipts). Berbeda
 * dengan /api/files (publik): nota keuangan hanya untuk role purchasing/
 * finance, jadi wajib lewat route ber-auth ini.
 */
const VIEW_ROLES = ["admin", "super_admin", "purchasing_admin", "finance_staff", "direksi"] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    await requireApiRole([...VIEW_ROLES]);
    const { path: segments } = await params;

    const decoded = segments.map(decodeURIComponent);
    if (decoded.some((s) => s.includes("..") || s.startsWith(".") || s.includes("\\"))) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }

    // readPrivateFile sudah menolak traversal; prefix folder dikunci di sini.
    const rel = ["purchasing-receipts", ...decoded].join("/");
    const { data, mime } = await readPrivateFile(rel);
    if (!data) return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error serving receipt:", error);
    return NextResponse.json({ error: "Gagal memuat file" }, { status: 500 });
  }
}
