import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";

/**
 * GET /api/hris/performance/reviews?cycle_id=…
 * Daftar review dalam satu siklus, disaring per peran:
 *   HRD           — semua karyawan;
 *   Head Division — anggota departemennya (karena punya bawahan langsung);
 *   karyawan lain — hanya review miliknya sendiri.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cycleId = req.nextUrl.searchParams.get("cycle_id") ?? "";
    if (!UUID_RE.test(cycleId)) {
      return NextResponse.json({ error: "Parameter cycle_id wajib" }, { status: 400 });
    }

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

    let where = "";
    const params: unknown[] = [cycleId];
    if (!actor.isHr) {
      if (isHead) {
        params.push(me!.department_id, actor.employeeId);
        where = `AND (r.employee_department_id = $2 OR r.employee_id = $3)`;
      } else if (actor.employeeId) {
        params.push(actor.employeeId);
        where = `AND r.employee_id = $2`;
      } else {
        return NextResponse.json({ data: { reviews: [], can_review: false } });
      }
    }

    const reviews = await query(
      `SELECT r.id, r.employee_id, e.full_name, e.nip, d.name AS department_name,
              r.status, r.total_work_result_score, r.total_behavioral_score,
              r.total_project_score, r.grand_total_score, r.category,
              r.employee_sign_date::text, r.reviewer_sign_date::text,
              r.reviewer_name,
              (SELECT count(*) FROM performance.behavioral_review_items i
               WHERE i.review_id = r.id AND i.score IS NOT NULL)::int AS rated_items,
              (SELECT count(*) FROM performance.behavioral_review_items i
               WHERE i.review_id = r.id)::int AS total_items
       FROM performance.performance_reviews r
       JOIN hris.employees e ON e.id = r.employee_id
       LEFT JOIN hris.departments d ON d.id = r.employee_department_id
       WHERE r.cycle_id = $1 ${where}
       ORDER BY d.name NULLS LAST, e.full_name`,
      params
    );

    return NextResponse.json({
      data: {
        reviews,
        can_review: actor.isHr || isHead,
        is_hr: actor.isHr,
        my_employee_id: actor.employeeId,
      },
    });
  } catch (error) {
    console.error("[performance/reviews] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
