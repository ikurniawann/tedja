import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { runKpiSnapshot } from "@/lib/kpi/snapshot";
import { KPI_MANAGE_ROLES } from "@/lib/kpi/roles";

/**
 * POST /api/hris/kpi/snapshot { period_month, period_year }
 * Jalankan snapshot KPI bulanan (idempoten — scorecard final tak ditimpa).
 * EPIC-010 Fase B.
 */
export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.hrisPerformance);
    const body = await request.json().catch(() => ({}));

    const now = new Date();
    const periodMonth =
      body.period_month == null ? now.getMonth() + 1 : Number(body.period_month);
    const periodYear =
      body.period_year == null ? now.getFullYear() : Number(body.period_year);
    if (
      !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12 ||
      !Number.isInteger(periodYear) || periodYear < 2020 || periodYear > 2100
    ) {
      return NextResponse.json({ error: "Periode tidak valid" }, { status: 400 });
    }

    const summary = await runKpiSnapshot({ periodYear, periodMonth });
    return NextResponse.json({
      data: summary,
      message: `Snapshot KPI ${periodMonth}/${periodYear}: ${summary.scorecards_upserted} scorecard diperbarui${summary.scorecards_skipped_final ? `, ${summary.scorecards_skipped_final} final dilewati` : ""}`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error running KPI snapshot:", error);
    return NextResponse.json(
      { error: "Gagal menjalankan snapshot KPI" },
      { status: 500 }
    );
  }
}
