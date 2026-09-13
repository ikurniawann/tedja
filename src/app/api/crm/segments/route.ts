import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { segmentSchema } from "@/lib/crm/segments";
import { requireSegmentUser, segmentCompanyId } from "@/lib/crm/segments-server";

/** EPIC-050 T-5.1 — daftar & buat segmen dinamis. */
export async function GET() {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const params: unknown[] = [];
  let where = "s.deleted_at IS NULL";
  if (scope?.companyId) {
    params.push(scope.companyId);
    where += ` AND (s.company_id IS NULL OR s.company_id = $${params.length})`;
  }
  const rows = await query(
    `SELECT s.id, s.company_id, s.name, s.description, s.source, s.definition, s.is_active,
            s.last_count, s.last_counted_at, s.created_by, s.created_at, s.updated_at,
            u.full_name AS creator_name
     FROM crm.crm_segments s
     LEFT JOIN configuration.users u ON u.id = s.created_by
     WHERE ${where}
     ORDER BY s.is_active DESC, s.updated_at DESC`,
    params
  );
  return successResponse(rows);
}

export async function POST(request: NextRequest) {
  const { error, user, scope } = await requireSegmentUser();
  if (error) return error;
  const parsed = segmentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const row = await queryOne(
    `INSERT INTO crm.crm_segments (company_id, name, description, source, definition, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, name, source, is_active`,
    [segmentCompanyId(user, scope), b.name, b.description ?? null, b.definition.source, JSON.stringify(b.definition), b.is_active, user.id]
  );
  return createdResponse(row, "Segmen dibuat");
}
