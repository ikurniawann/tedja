import { NextResponse } from "next/server";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import type { UserRole } from "@/types";
import {
  EXECUTIVE_DASHBOARD_ROLES,
  buildExecutiveDashboard,
  type ExecutiveDashboard,
} from "@/lib/dashboard/executive";

/**
 * GET /api/dashboard/executive — data dashboard eksekutif (EPIC-021).
 * Gate + cache mengikuti pola /api/desktop/overview: super_admin + direksi,
 * cache in-memory 60 dtk, hasil yang memuat seksi gagal tidak di-cache.
 */

const CACHE_TTL_MS = 60_000;
let cached: { at: number; data: ExecutiveDashboard } | null = null;

export async function GET() {
  try {
    await requireApiRole([...EXECUTIVE_DASHBOARD_ROLES] as UserRole[]);

    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: cached.data, cached: true });
    }

    const data = await buildExecutiveDashboard();
    if (data.gagal.length === 0) {
      cached = { at: Date.now(), data };
    }

    return NextResponse.json({ data, cached: false });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dashboard:executive] gagal:", error);
    return NextResponse.json({ error: "Gagal memuat dashboard" }, { status: 500 });
  }
}
