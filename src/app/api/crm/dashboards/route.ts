import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { canManageShared, reportCompanyId, requireReportUser } from "@/lib/crm/report-builder-server";

/** EPIC-050 T-4.2 — daftar & buat dashboard CRM. */
export async function GET() {
  const { error, scope } = await requireReportUser();
  if (error) return error;
  const params: unknown[] = [];
  let where = "d.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (d.company_id IS NULL OR d.company_id = $${params.length})`;
  }
  const rows = await query(
    `SELECT d.id, d.company_id, d.name, d.description, d.is_default, d.created_by, d.created_at, d.updated_at,
            u.full_name AS creator_name,
            (SELECT COUNT(*) FROM crm.crm_dashboard_widgets w WHERE w.dashboard_id = d.id) AS widget_count
     FROM crm.crm_dashboards d
     LEFT JOIN configuration.users u ON u.id = d.created_by
     WHERE ${where}
     ORDER BY d.is_default DESC, d.name`,
    params
  );
  return successResponse(rows);
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  is_default: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireReportUser();
  if (error) return error;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const companyId = reportCompanyId(user, scope);
  const makeDefault = b.is_default && canManageShared(user);
  if (makeDefault) {
    await query(
      `UPDATE crm.crm_dashboards SET is_default = false, updated_at = now()
       WHERE is_default AND deleted_at IS NULL
         AND COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
      [companyId]
    );
  }
  const row = await queryOne(
    `INSERT INTO crm.crm_dashboards (company_id, name, description, is_default, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, is_default`,
    [companyId, b.name, b.description ?? null, makeDefault, user.id]
  );
  return createdResponse(row, "Dashboard dibuat");
}
