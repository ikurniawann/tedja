import { NextRequest, NextResponse } from "next/server";
import { getWorkforceActor } from "@/lib/hris/workforce-auth";
import { getPool } from "@/lib/db";
import { computeAttainment } from "@/lib/kpi/attainment";
import { recomposeScorecard } from "@/lib/kpi/snapshot";
import { KPI_MANAGE_ROLES } from "@/lib/kpi/roles";

const RUBRIC_CODE = "supervisor_rubric";
const RUBRIC_MAX = 5;
const NOTES_MAX = 2000;

/**
 * POST /api/hris/kpi/rubric — input penilaian atasan (rubrik 1-5) utk satu
 * karyawan-periode; tersimpan sebagai kpi_snapshot manual lalu scorecard
 * disusun ulang. Scorecard final ditolak (409).
 * Akses (Fase E): KPI_MANAGE_ROLES ATAU atasan langsung karyawan tsb
 * (employees.reporting_to = employee milik penilai).
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await getWorkforceActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));

    const employeeId = body.employee_id;
    const periodMonth = Number(body.period_month);
    const periodYear = Number(body.period_year);
    const value = Number(body.value);
    const notes = typeof body.notes === "string" ? body.notes.slice(0, NOTES_MAX) : null;

    if (!employeeId || !Number.isInteger(periodMonth) || periodMonth < 1 ||
        periodMonth > 12 || !Number.isInteger(periodYear)) {
      return NextResponse.json({ error: "Parameter tidak lengkap" }, { status: 400 });
    }
    if (!Number.isFinite(value) || value < 1 || value > RUBRIC_MAX) {
      return NextResponse.json(
        { error: `Nilai rubrik harus 1-${RUBRIC_MAX}` },
        { status: 400 }
      );
    }

    const pool = getPool();

    // Otorisasi: manage roles bebas; selain itu wajib atasan langsung.
    const isManageRole = (KPI_MANAGE_ROLES as readonly string[]).includes(
      actor.role
    );
    if (!isManageRole) {
      const { rows: targetRows } = await pool.query(
        `SELECT reporting_to FROM hris.employees WHERE id = $1`,
        [employeeId]
      );
      const reportingTo = targetRows[0]?.reporting_to ?? null;
      if (!actor.employeeId || reportingTo !== actor.employeeId) {
        return NextResponse.json(
          { error: "Hanya HRD atau atasan langsung yang boleh menilai" },
          { status: 403 }
        );
      }
    }

    const [{ rows: indicatorRows }, { rows: scorecardRows }] = await Promise.all([
      pool.query(
        `SELECT id FROM performance.kpi_indicators WHERE code = $1`,
        [RUBRIC_CODE]
      ),
      pool.query(
        `SELECT status FROM performance.kpi_scorecards
         WHERE employee_id = $1 AND period_year = $2 AND period_month = $3`,
        [employeeId, periodYear, periodMonth]
      ),
    ]);
    if (indicatorRows.length === 0) {
      return NextResponse.json(
        { error: "Indikator rubrik tidak ditemukan" },
        { status: 500 }
      );
    }
    if (scorecardRows[0]?.status === "final") {
      return NextResponse.json(
        { error: "Scorecard sudah final — buka kembali dulu untuk mengubah rubrik" },
        { status: 409 }
      );
    }

    const attainment = computeAttainment({
      direction: "higher_better",
      actual: value,
      target: RUBRIC_MAX,
    });

    await pool.query(
      `INSERT INTO performance.kpi_snapshots
         (employee_id, indicator_id, period_year, period_month,
          actual, target, attainment, sample_size, source_detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8)
       ON CONFLICT (employee_id, indicator_id, period_year, period_month)
       DO UPDATE SET actual = EXCLUDED.actual, target = EXCLUDED.target,
         attainment = EXCLUDED.attainment,
         source_detail = EXCLUDED.source_detail, updated_at = now()`,
      [
        employeeId,
        indicatorRows[0].id,
        periodYear,
        periodMonth,
        value,
        RUBRIC_MAX,
        attainment,
        JSON.stringify({ rated_by: actor.userId, notes }),
      ]
    );

    const result = await recomposeScorecard({ employeeId, periodYear, periodMonth });
    return NextResponse.json({
      data: { score: result.score, status: result.status },
      message: "Rubrik tersimpan & scorecard diperbarui",
    });
  } catch (error) {
    console.error("Error saving KPI rubric:", error);
    return NextResponse.json(
      { error: "Gagal menyimpan rubrik" },
      { status: 500 }
    );
  }
}
