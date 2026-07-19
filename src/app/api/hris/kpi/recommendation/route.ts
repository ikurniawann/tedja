import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getPool } from "@/lib/db";
import { KPI_MANAGE_ROLES } from "@/lib/kpi/roles";

/**
 * GET /api/hris/kpi/recommendation?employee_ids=a,b,c
 * Rata-rata skor scorecard 3 periode terakhir per karyawan — decision
 * support perpanjangan kontrak PKWT (EPIC-010 Fase D). Keputusan tetap
 * di manusia; endpoint hanya menyajikan angka.
 */
export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...KPI_MANAGE_ROLES]);
    const { searchParams } = new URL(request.url);
    const ids = (searchParams.get("employee_ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (ids.length === 0) return NextResponse.json({ data: {} });

    const pool = getPool();
    const { rows } = await pool.query(
      `WITH ranked AS (
         SELECT employee_id, score::float AS score, status,
                ROW_NUMBER() OVER (
                  PARTITION BY employee_id
                  ORDER BY period_year DESC, period_month DESC
                ) AS rn
         FROM performance.kpi_scorecards
         WHERE employee_id = ANY($1::uuid[]) AND score IS NOT NULL
       )
       SELECT employee_id,
              AVG(score)::float AS avg_score,
              COUNT(*)::int AS periods,
              BOOL_OR(status = 'final') AS has_final
       FROM ranked WHERE rn <= 3
       GROUP BY employee_id`,
      [ids]
    );

    const data: Record<
      string,
      { avg_score: number; periods: number; has_final: boolean }
    > = {};
    for (const row of rows) {
      data[row.employee_id] = {
        avg_score: Math.round(row.avg_score * 100) / 100,
        periods: row.periods,
        has_final: row.has_final,
      };
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching KPI recommendation:", error);
    return NextResponse.json(
      { error: "Gagal mengambil rekomendasi KPI" },
      { status: 500 }
    );
  }
}
