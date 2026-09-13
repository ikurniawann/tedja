import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireCrmSettingsUser } from "@/lib/crm/advance-guard";

/** Log eksekusi satu rule (50 terakhir) + aksi terjadwal yang masih menunggu. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user, scope } = await requireCrmSettingsUser();
  if (error) return error;
  const { id } = await params;
  const rule = await queryOne<{ id: string; company_id: string | null }>(`SELECT id, company_id FROM crm.crm_workflow_rules WHERE id = $1`, [id]);
  if (!rule || (user.role !== "super_admin" && rule.company_id && scope?.companyId && rule.company_id !== scope.companyId)) {
    return NextResponse.json({ success: false, error: "Rule tidak ditemukan" }, { status: 404 });
  }
  const runs = await query(
    `SELECT id, subject_type, subject_id, status, actions_result, error, created_at
     FROM crm.crm_workflow_runs WHERE rule_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [id]
  );
  const scheduled = await query(
    `SELECT id, subject_type, subject_id, run_at, status, attempts, last_error
     FROM crm.crm_scheduled_actions WHERE rule_id = $1 AND status = 'pending' ORDER BY run_at LIMIT 50`,
    [id]
  );
  return successResponse({ runs, scheduled });
}
