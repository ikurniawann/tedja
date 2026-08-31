import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { quarterMonths } from "@/lib/hris/performance-review";

/**
 * GET /api/hris/performance/realtime?year&quarter
 * Report KPI BERJALAN kuartal ini (permintaan owner 2026-08-31): rata-rata
 * quarter-to-date dari scorecard bulanan per karyawan + skor per bulannya —
 * supaya kinerja bisa dipantau sebelum siklus review dibuka.
 * Lingkup per peran sama seperti daftar review: HRD semua, Head Division
 * departemennya, karyawan lain dirinya sendiri.
 */

export async function GET(req: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const now = new Date();
    const year = Number(req.nextUrl.searchParams.get("year")) || now.getFullYear();
    const quarter =
      Number(req.nextUrl.searchParams.get("quarter")) || Math.floor(now.getMonth() / 3) + 1;
    if (year < 2020 || year > 2100 || quarter < 1 || quarter > 4) {
      return NextResponse.json({ error: "Periode tidak valid" }, { status: 400 });
    }
    const months = quarterMonths(quarter);

    const me = actor.employeeId
      ? await queryOne<{ department_id: string | null; subordinates: number }>(
          `SELECT e.department_id,
                  (SELECT count(*) FROM hris.employees s
                   WHERE s.reporting_to = e.id AND s.is_active)::int AS subordinates
           FROM hris.employees e WHERE e.id = $1`,
          [actor.employeeId]
        )
      : null;
    const isHead = (me?.subordinates ?? 0) > 0 && !!me?.department_id;

    let where = "e.is_active = true";
    const params: unknown[] = [year, months];
    if (!actor.isHr) {
      if (isHead) {
        params.push(me!.department_id);
        where += ` AND e.department_id = $3`;
      } else if (actor.employeeId) {
        params.push(actor.employeeId);
        where += ` AND e.id = $3`;
      } else {
        return NextResponse.json({
          data: { employees: [], year, quarter, months, is_hr: false },
        });
      }
    }

    const employees = await query(
      `SELECT e.id, e.full_name, d.name AS department_name,
              AVG(s.score)::numeric(6,2) AS avg_score,
              json_agg(
                json_build_object('month', s.period_month, 'score', s.score, 'status', s.status)
                ORDER BY s.period_month
              ) FILTER (WHERE s.id IS NOT NULL) AS months
       FROM hris.employees e
       LEFT JOIN hris.departments d ON d.id = e.department_id
       LEFT JOIN performance.kpi_scorecards s
         ON s.employee_id = e.id AND s.period_year = $1
        AND s.period_month = ANY($2::int[])
       WHERE ${where}
       GROUP BY e.id, e.full_name, d.name
       ORDER BY AVG(s.score) DESC NULLS LAST, e.full_name`,
      params
    );

    return NextResponse.json({
      data: { employees, year, quarter, months, is_hr: actor.isHr },
    });
  } catch (error) {
    console.error("[performance/realtime] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
