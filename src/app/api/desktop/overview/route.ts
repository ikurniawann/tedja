import { NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import {
  DESKTOP_OVERVIEW_ROLES,
  buildDesktopOverview,
  type DesktopOverview,
} from "@/lib/desktop/overview";

/**
 * GET /api/desktop/overview — data papan monitoring desktop (EPIC-019).
 *
 * Digate role super_admin + direksi (padanan "owner" — role itu belum ada di
 * iam). Cache in-memory 60 detik: interval refresh klien juga 60 detik, jadi
 * beberapa tab/user berbagi satu kali kerja query alih-alih menumbuk DB
 * bersamaan. Cache per-proses PM2 — cukup, karena datanya ringkasan monitoring,
 * bukan transaksi.
 */

const CACHE_TTL_MS = 60_000;
let cached: { at: number; data: DesktopOverview } | null = null;

export async function GET() {
  try {
    await requireApiRole([...DESKTOP_OVERVIEW_ROLES]);

    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: cached.data, cached: true });
    }

    const data = await buildDesktopOverview();
    // Hasil dengan seksi gagal tidak di-cache: biarkan percobaan berikutnya
    // mencoba lagi, daripada mengunci kartu error selama 60 detik.
    if (data.gagal.length === 0) {
      cached = { at: Date.now(), data };
    }

    return NextResponse.json({ data, cached: false });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[desktop:overview] gagal:", error);
    return NextResponse.json({ error: "Gagal memuat ringkasan" }, { status: 500 });
  }
}
