import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, withTransaction } from "@/lib/db";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { quarterLabel, quarterRange, recalcReview } from "@/lib/hris/performance-review";

/**
 * Siklus Performance Review kuartalan (owner 2026-08-31, Fase 1).
 *
 * GET  — daftar siklus + progres pengisiannya. Semua karyawan boleh
 *        melihat daftar (isinya sendiri disaring di endpoint reviews).
 * POST — HRD membuka siklus baru {period_year, period_quarter}; sistem
 *        otomatis membuat draft review untuk semua karyawan aktif,
 *        menyalin standar perilaku aktif sebagai item penilaian, dan
 *        mengisi nilai Hasil Kerja dari rata-rata KPI kuartal itu.
 */

export async function GET() {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cycles = await query(
      `SELECT c.id, c.name, c.period_year, c.period_quarter,
              c.start_date::text, c.end_date::text, c.status, c.created_by_name,
              count(r.id)::int AS total_reviews,
              count(r.id) FILTER (WHERE r.status = 'final')::int AS final_reviews,
              count(r.id) FILTER (WHERE r.total_behavioral_score > 0)::int AS rated_reviews
       FROM performance.review_cycles c
       LEFT JOIN performance.performance_reviews r ON r.cycle_id = c.id
       GROUP BY c.id
       ORDER BY c.period_year DESC, c.period_quarter DESC`
    );
    return NextResponse.json({ data: { cycles, is_hr: actor.isHr } });
  } catch (error) {
    console.error("[performance/cycles] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PostBody {
  period_year?: number;
  period_quarter?: number;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!actor.isHr) {
      return NextResponse.json(
        { error: "Hanya HRD yang boleh membuka siklus review" },
        { status: 403 }
      );
    }

    const body = (await req.json()) as PostBody;
    const year = Number(body.period_year);
    const quarter = Number(body.period_quarter);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return NextResponse.json({ error: "Tahun tidak valid" }, { status: 400 });
    }
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      return NextResponse.json({ error: "Kuartal harus 1–4" }, { status: 400 });
    }
    const exists = await queryOne<{ id: string }>(
      `SELECT id FROM performance.review_cycles WHERE period_year = $1 AND period_quarter = $2`,
      [year, quarter]
    );
    if (exists) {
      return NextResponse.json(
        { error: `Siklus ${quarterLabel(year, quarter)} sudah ada` },
        { status: 409 }
      );
    }

    const creatorName = actor.employeeId
      ? (
          await queryOne<{ full_name: string }>(
            `SELECT full_name FROM hris.employees WHERE id = $1`,
            [actor.employeeId]
          )
        )?.full_name ?? "HRD"
      : "HRD";

    const { start, end } = quarterRange(year, quarter);
    const label = quarterLabel(year, quarter);

    const reviewIds: string[] = [];
    await withTransaction(async (client) => {
      const cycle = await client.query(
        `INSERT INTO performance.review_cycles
           (name, period_year, period_quarter, start_date, end_date, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [label, year, quarter, start, end, creatorName]
      );
      const cycleId: string = cycle.rows[0].id;

      // Draft review untuk semua karyawan aktif + snapshot standar perilaku
      // (disalin per review supaya perubahan standar berikutnya tidak
      // mengubah review yang sudah berjalan).
      const created = await client.query(
        `INSERT INTO performance.performance_reviews
           (cycle_id, employee_id, employee_department_id,
            period_label, start_date, end_date, status)
         SELECT $1, e.id, e.department_id, $2, $3, $4, 'draft'
         FROM hris.employees e WHERE e.is_active = true
         RETURNING id`,
        [cycleId, label, start, end]
      );
      for (const row of created.rows as { id: string }[]) {
        reviewIds.push(row.id);
      }
      await client.query(
        `INSERT INTO performance.behavioral_review_items
           (review_id, employee_id, value_name, competency, behavioral_standard,
            score_1_description, score_2_description, score_3_description,
            score_4_description, score_5_description, weight, item_order)
         SELECT r.id, r.employee_id, s.value_name, s.competency_name,
                s.standard_description, s.score_1_description, s.score_2_description,
                s.score_3_description, s.score_4_description, s.score_5_description,
                s.weight, row_number() OVER (PARTITION BY r.id ORDER BY s.created_at)
         FROM performance.performance_reviews r
         JOIN performance.behavioral_standards s ON s.is_active = true
         WHERE r.cycle_id = $1`,
        [cycleId]
      );
    });

    // Prefill Hasil Kerja dari KPI kuartal (di luar transaksi; idempoten)
    for (const reviewId of reviewIds) {
      await recalcReview(reviewId);
    }

    return NextResponse.json(
      {
        message: `Siklus ${label} dibuka — ${reviewIds.length} draft review dibuat`,
        data: { review_count: reviewIds.length },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[performance/cycles] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
