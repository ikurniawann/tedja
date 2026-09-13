import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { query, queryOne, withTransaction } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/** EPIC-050 T-3.1 — daftar pipeline + tahapnya (untuk tab kanban & form deal). */
export async function GET(request: NextRequest) {
  const { error } = await requireSalesFunnelRole();
  if (error) return error;
  const scope = await getApiUserScope();
  const all = new URL(request.url).searchParams.get("all") === "1";
  const pipelines = await query(
    `SELECT p.id, p.code, p.name, p.description, p.is_default, p.sort_order, p.is_active, p.company_id,
            (SELECT count(*) FROM crm.crm_sales_deals d WHERE d.pipeline_id = p.id AND d.deleted_at IS NULL AND d.closed_at IS NULL)::int AS open_deals
     FROM crm.crm_pipelines p
     WHERE (p.company_id IS NULL OR p.company_id = $1) ${all ? "" : "AND p.is_active"}
     ORDER BY p.is_default DESC, p.sort_order, p.name`,
    [scope?.companyId ?? null]
  );
  const stages = await query(
    `SELECT id, pipeline_id, code, name, sort_order, is_won, is_lost, stuck_threshold_days, probability, is_active
     FROM crm.crm_sales_stages WHERE pipeline_id IS NOT NULL ${all ? "" : "AND is_active"}
     ORDER BY sort_order, created_at`
  );
  const byPipeline = new Map<string, unknown[]>();
  for (const s of stages as Array<{ pipeline_id: string }>) {
    const list = byPipeline.get(s.pipeline_id) ?? [];
    list.push(s);
    byPipeline.set(s.pipeline_id, list);
  }
  return successResponse(
    (pipelines as Array<{ id: string }>).map((p) => ({ ...p, stages: byPipeline.get(p.id) ?? [] }))
  );
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().regex(/^[a-z0-9-]{2,40}$/).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  /** tahap awal (tanpa menang/kalah; keduanya dibuat otomatis) */
  stages: z.array(z.object({ name: z.string().trim().min(1).max(100), probability: z.number().int().min(0).max(100).default(10) })).min(1).max(12),
});

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  if (user.role !== "super_admin" && user.role !== "admin") {
    return NextResponse.json({ success: false, error: "Hanya admin/super admin yang boleh membuat pipeline" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const code = b.code ?? b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
  const dup = await queryOne<{ id: string }>(`SELECT id FROM crm.crm_pipelines WHERE code = $1`, [code]);
  if (dup) return NextResponse.json({ success: false, error: "Kode pipeline sudah dipakai" }, { status: 409 });
  const scope = await getApiUserScope();
  const row = await withTransaction(async (client) => {
    const p = await client.query<{ id: string }>(
      `INSERT INTO crm.crm_pipelines (company_id, code, name, description, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order), 0) + 10 FROM crm.crm_pipelines)) RETURNING id`,
      [user.role === "super_admin" && !scope?.companyId ? null : scope?.companyId ?? null, code, b.name, b.description ?? null]
    );
    const pipelineId = p.rows[0].id;
    let order = 10;
    for (const s of b.stages) {
      await client.query(
        `INSERT INTO crm.crm_sales_stages (code, name, sort_order, probability, pipeline_id, stuck_threshold_days)
         VALUES ($1, $2, $3, $4, $5, 7)`,
        [`${code}-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30)}-${order}`, s.name, order, s.probability, pipelineId]
      );
      order += 10;
    }
    await client.query(
      `INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_won, probability, pipeline_id, stuck_threshold_days) VALUES ($1, 'Menang', $2, true, 100, $3, 0)`,
      [`${code}-menang`, order, pipelineId]
    );
    await client.query(
      `INSERT INTO crm.crm_sales_stages (code, name, sort_order, is_lost, probability, pipeline_id, stuck_threshold_days) VALUES ($1, 'Kalah', $2, true, 0, $3, 0)`,
      [`${code}-kalah`, order + 10, pipelineId]
    );
    return { id: pipelineId, code, name: b.name };
  });
  return createdResponse(row, "Pipeline dibuat");
}
