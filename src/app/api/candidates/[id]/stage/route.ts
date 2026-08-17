import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";
import { CANDIDATE_STATUS_LABELS } from "@/lib/recruitment/status";

/**
 * POST /api/candidates/[id]/stage — pindahkan kandidat ke tahap lain.
 * Satu-satunya jalur perpindahan status (pipeline drag, drawer, detail page)
 * supaya SETIAP perpindahan meninggalkan jejak di candidate_activities
 * lengkap dengan nama HR yang melakukannya.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;
const VALID_STATUSES = new Set(Object.keys(CANDIDATE_STATUS_LABELS));

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const status = typeof body.status === "string" ? body.status : "";
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Status tidak valid" }, { status: 400 });
    }

    const candidate = await queryOne<{ id: string; status: string }>(
      "SELECT id, status FROM recruitment.candidates WHERE id = $1",
      [id]
    );
    if (!candidate) {
      return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
    }
    if (candidate.status === status) {
      return NextResponse.json({ data: { status }, message: "Status tidak berubah" });
    }

    await query(
      "UPDATE recruitment.candidates SET status = $1, updated_at = now() WHERE id = $2",
      [status, id]
    );

    const fromLabel =
      CANDIDATE_STATUS_LABELS[candidate.status as keyof typeof CANDIDATE_STATUS_LABELS] ??
      candidate.status;
    const toLabel =
      CANDIDATE_STATUS_LABELS[status as keyof typeof CANDIDATE_STATUS_LABELS] ?? status;

    await query(
      `INSERT INTO recruitment.candidate_activities
         (candidate_id, activity_type, description, created_by, created_by_name)
       VALUES ($1, 'status_change', $2, $3, $4)`,
      [id, `Tahap diubah: ${fromLabel} → ${toLabel}`, user.id, user.full_name]
    );

    return NextResponse.json({
      data: { status, previous: candidate.status },
      message: `Kandidat dipindahkan ke ${toLabel}`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-stage] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
