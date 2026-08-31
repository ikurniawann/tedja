import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { quarterMonths, recalcReview } from "@/lib/hris/performance-review";

/**
 * Detail & aksi satu Performance Review (owner 2026-08-31, Fase 1).
 *
 * GET   — detail review + item perilaku + rincian KPI per bulan kuartal.
 * PATCH — aksi bertahap:
 *   self_assessment {text}          — karyawan ybs (sebelum final)
 *   rate_item {item_id, score 1–5, notes?} — Head Division dept tsb / HRD
 *   reviewer_notes {text, project_score?}  — Head Division / HRD
 *   sign  — karyawan ybs ATAU reviewer (Head/HRD) menandatangani
 *   finalize — HRD mengunci review (status 'final')
 * Setelah final, semua isian terkunci.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReviewRow {
  id: string;
  cycle_id: string;
  employee_id: string;
  employee_department_id: string | null;
  status: string;
  period_year: number;
  period_quarter: number;
}

async function loadReview(id: string): Promise<ReviewRow | null> {
  return queryOne<ReviewRow>(
    `SELECT r.id, r.cycle_id, r.employee_id, r.employee_department_id, r.status,
            c.period_year, c.period_quarter
     FROM performance.performance_reviews r
     JOIN performance.review_cycles c ON c.id = r.cycle_id
     WHERE r.id = $1`,
    [id]
  );
}

/** Head Division departemen review ini: punya bawahan langsung aktif di dept yg sama. */
async function isDeptHead(employeeId: string | null, departmentId: string | null) {
  if (!employeeId || !departmentId) return false;
  const head = await queryOne<{ ok: boolean }>(
    `SELECT (e.department_id = $2 AND EXISTS (
       SELECT 1 FROM hris.employees s WHERE s.reporting_to = e.id AND s.is_active
     )) AS ok
     FROM hris.employees e WHERE e.id = $1 AND e.is_active`,
    [employeeId, departmentId]
  );
  return head?.ok === true;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }
    const review = await loadReview(id);
    if (!review) return NextResponse.json({ error: "Review tidak ditemukan" }, { status: 404 });

    const head = await isDeptHead(actor.employeeId, review.employee_department_id);
    const isOwner = actor.employeeId === review.employee_id;
    if (!actor.isHr && !head && !isOwner) {
      return NextResponse.json({ error: "Tidak berhak melihat review ini" }, { status: 403 });
    }

    const months = quarterMonths(Number(review.period_quarter));
    const [detail, items, kpiMonths] = await Promise.all([
      queryOne(
        `SELECT r.*, r.start_date::text AS start_date, r.end_date::text AS end_date,
                r.reviewee_sign_date::text AS reviewee_sign_date,
                r.reviewer_sign_date::text AS reviewer_sign_date,
                r.employee_sign_date::text AS employee_sign_date,
                e.full_name, e.nip, d.name AS department_name, c.name AS cycle_name,
                c.status AS cycle_status
         FROM performance.performance_reviews r
         JOIN hris.employees e ON e.id = r.employee_id
         LEFT JOIN hris.departments d ON d.id = r.employee_department_id
         JOIN performance.review_cycles c ON c.id = r.cycle_id
         WHERE r.id = $1`,
        [id]
      ),
      query(
        `SELECT id, value_name, competency, behavioral_standard,
                score_1_description, score_2_description, score_3_description,
                score_4_description, score_5_description, weight, score, notes, item_order
         FROM performance.behavioral_review_items
         WHERE review_id = $1 ORDER BY item_order, value_name`,
        [id]
      ),
      query(
        `SELECT period_month, score, status
         FROM performance.kpi_scorecards
         WHERE employee_id = $1 AND period_year = $2 AND period_month = ANY($3::int[])
         ORDER BY period_month`,
        [review.employee_id, review.period_year, months]
      ),
    ]);

    return NextResponse.json({
      data: {
        review: detail,
        items,
        kpi_months: kpiMonths,
        can_rate: actor.isHr || head,
        can_finalize: actor.isHr,
        is_owner: isOwner,
      },
    });
  } catch (error) {
    console.error("[performance/reviews/id] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PatchBody {
  action?: "self_assessment" | "rate_item" | "reviewer_notes" | "sign" | "finalize";
  text?: string | null;
  item_id?: string;
  score?: number;
  notes?: string | null;
  project_score?: number | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });
    }
    const review = await loadReview(id);
    if (!review) return NextResponse.json({ error: "Review tidak ditemukan" }, { status: 404 });

    const body = (await req.json()) as PatchBody;
    const action = body.action;
    if (review.status === "final" && action !== "sign") {
      return NextResponse.json(
        { error: "Review sudah final — tidak bisa diubah" },
        { status: 400 }
      );
    }

    const head = await isDeptHead(actor.employeeId, review.employee_department_id);
    const isOwner = actor.employeeId === review.employee_id;
    const myName = actor.employeeId
      ? (
          await queryOne<{ full_name: string }>(
            `SELECT full_name FROM hris.employees WHERE id = $1`,
            [actor.employeeId]
          )
        )?.full_name ?? "—"
      : "HRD";

    if (action === "self_assessment") {
      if (!isOwner) {
        return NextResponse.json(
          { error: "Hanya karyawan yang bersangkutan yang boleh mengisi self assessment" },
          { status: 403 }
        );
      }
      await queryOne(
        `UPDATE performance.performance_reviews
         SET self_assessment = $2, updated_at = now() WHERE id = $1 RETURNING id`,
        [id, String(body.text ?? "").trim() || null]
      );
      return NextResponse.json({ message: "Self assessment tersimpan" });
    }

    if (action === "rate_item") {
      if (!actor.isHr && !head) {
        return NextResponse.json(
          { error: "Hanya Head Division departemen ini (atau HRD) yang boleh menilai perilaku" },
          { status: 403 }
        );
      }
      const itemId = String(body.item_id || "");
      const score = Number(body.score);
      if (!UUID_RE.test(itemId)) {
        return NextResponse.json({ error: "ID item tidak valid" }, { status: 400 });
      }
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        return NextResponse.json({ error: "Skor harus 1–5" }, { status: 400 });
      }
      const updated = await queryOne(
        `UPDATE performance.behavioral_review_items
         SET score = $3::int, weighted_score = (weight * $3::numeric / 5.0), notes = $4, updated_at = now()
         WHERE id = $2 AND review_id = $1 RETURNING id`,
        [id, itemId, score, body.notes?.trim() || null]
      );
      if (!updated) {
        return NextResponse.json({ error: "Item bukan milik review ini" }, { status: 400 });
      }
      await queryOne(
        `UPDATE performance.performance_reviews
         SET reviewer_id = COALESCE(reviewer_id, $2), reviewer_name = $3, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, actor.employeeId, myName]
      );
      await recalcReview(id);
      return NextResponse.json({ message: "Penilaian tersimpan" });
    }

    if (action === "reviewer_notes") {
      if (!actor.isHr && !head) {
        return NextResponse.json(
          { error: "Hanya Head Division (atau HRD) yang boleh mengisi catatan reviewer" },
          { status: 403 }
        );
      }
      let projectScore: number | null = null;
      if (body.project_score !== null && body.project_score !== undefined) {
        const p = Number(body.project_score);
        if (!Number.isFinite(p) || p < 0 || p > 100) {
          return NextResponse.json({ error: "Nilai kontribusi harus 0–100" }, { status: 400 });
        }
        projectScore = p;
      }
      await queryOne(
        `UPDATE performance.performance_reviews
         SET reviewer_notes = $2, total_project_score = COALESCE($3, 0),
             reviewer_id = COALESCE(reviewer_id, $4), reviewer_name = $5, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, String(body.text ?? "").trim() || null, projectScore, actor.employeeId, myName]
      );
      await recalcReview(id);
      return NextResponse.json({ message: "Catatan reviewer tersimpan" });
    }

    if (action === "sign") {
      if (isOwner) {
        await queryOne(
          `UPDATE performance.performance_reviews
           SET employee_sign_date = CURRENT_DATE, updated_at = now()
           WHERE id = $1 RETURNING id`,
          [id]
        );
        return NextResponse.json({ message: "Ditandatangani sebagai karyawan" });
      }
      if (actor.isHr || head) {
        await queryOne(
          `UPDATE performance.performance_reviews
           SET reviewer_sign_date = CURRENT_DATE,
               reviewer_id = COALESCE(reviewer_id, $2), reviewer_name = COALESCE(reviewer_name, $3),
               updated_at = now()
           WHERE id = $1 RETURNING id`,
          [id, actor.employeeId, myName]
        );
        return NextResponse.json({ message: "Ditandatangani sebagai reviewer" });
      }
      return NextResponse.json({ error: "Tidak berhak menandatangani review ini" }, { status: 403 });
    }

    if (action === "finalize") {
      if (!actor.isHr) {
        return NextResponse.json({ error: "Hanya HRD yang boleh memfinalkan review" }, { status: 403 });
      }
      await recalcReview(id);
      await queryOne(
        `UPDATE performance.performance_reviews
         SET status = 'final', manager_id = $2, manager_notes = COALESCE(manager_notes, $3),
             updated_at = now()
         WHERE id = $1 RETURNING id`,
        [id, actor.employeeId, body.text?.trim() || null]
      );
      return NextResponse.json({ message: "Review difinalkan — nilai terkunci" });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
  } catch (error) {
    console.error("[performance/reviews/id] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
