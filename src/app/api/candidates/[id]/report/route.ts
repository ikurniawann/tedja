import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getPipelineReportData } from "@/lib/recruitment/pipeline-report";
import { buildPipelineReportPdf } from "@/lib/recruitment/pipeline-report-pdf";
import { reportFileName } from "@/lib/recruitment/pipeline-report-format";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/candidates/[id]/report — PDF laporan perjalanan pipeline kandidat
 * (profil, analisis AI CV, screening, psikotes, interview AI, offer, timeline).
 * Digenerate on-the-fly agar selalu mengikuti data terbaru; tersedia mulai
 * tahap Offer.
 */

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const REPORT_STAGES = new Set(["offer", "hired"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "ID kandidat tidak valid" }, { status: 400 });
    }
    if (!checkRateLimit(`pipeline_report_${user.id}`, 30).allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan, coba lagi sebentar lagi" },
        { status: 429 }
      );
    }

    const data = await getPipelineReportData(id);
    if (!data) {
      return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
    }
    if (!REPORT_STAGES.has(data.candidate.status)) {
      return NextResponse.json(
        { error: "Laporan pipeline tersedia mulai tahap Offer" },
        { status: 409 }
      );
    }

    const pdf = await buildPipelineReportPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `attachment; filename="${reportFileName(data.candidate.full_name)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[pipeline-report] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
