import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getApiUser, successResponse } from "@/lib/api/auth";
import { decideApproval } from "@/lib/crm/approvals-server";
import { emitCrmEvent } from "@/lib/crm/events";
import { queryOne } from "@/lib/db";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(1000).optional().nullable(),
});

/** Keputusan approver pada tingkat berjalan. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const result = await decideApproval(id, parsed.data.decision, parsed.data.comment ?? null, { id: user.id, role: user.role });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.code });
  const req = await queryOne<{ subject_id: string; company_id: string; branch_id: string | null }>(
    `SELECT subject_id, company_id, branch_id FROM crm.crm_approval_requests WHERE id = $1`,
    [id]
  );
  if (req) {
    await emitCrmEvent({
      event_type: "quotation.status_changed",
      subject_type: "quotation",
      subject_id: req.subject_id,
      company_id: req.company_id,
      branch_id: req.branch_id,
      actor_user_id: user.id,
      payload: { approval: result.status, decision: parsed.data.decision },
    });
  }
  return successResponse(result, result.status === "approved" ? "Disetujui — quotation boleh dikirim" : result.status === "rejected" ? "Ditolak" : `Disetujui tingkat ini — lanjut ke tingkat ${result.next_level}`);
}
