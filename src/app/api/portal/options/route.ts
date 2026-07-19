import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

/**
 * GET /api/portal/options[?opening=<uuid>]
 *
 * Endpoint PUBLIK untuk form lamaran portal karir:
 * - outlets: outlet aktif (item.brands = mirror otomatis dari Business
 *   hierarchy level Branch, lihat migration 20260714120000)
 * - positions: posisi aktif
 * - opening: brand/posisi dari job opening (untuk auto-fill), jika diminta
 *
 * Hanya data non-sensitif (nama outlet & judul posisi yang memang tampil
 * publik di halaman karir).
 */
export async function GET(request: NextRequest) {
  try {
    const openingId = request.nextUrl.searchParams.get("opening");

    const [outlets, positions] = await Promise.all([
      query<{ id: string; name: string }>(
        "SELECT id, name FROM item.brands WHERE is_active = true ORDER BY name"
      ),
      query<{ id: string; title: string; brand_id: string | null }>(
        "SELECT id, title, brand_id FROM hris.positions WHERE is_active = true ORDER BY title"
      ),
    ]);

    let opening: { brand_id: string | null; position_id: string | null } | null = null;
    if (openingId && /^[0-9a-f-]{36}$/i.test(openingId)) {
      opening = await queryOne(
        "SELECT brand_id, position_id FROM hris.job_openings WHERE id = $1",
        [openingId]
      );
    }

    return NextResponse.json({ data: { outlets, positions, opening } });
  } catch (error) {
    console.error("[portal/options] failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
