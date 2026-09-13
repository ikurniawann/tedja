import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, createdResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const STAGE_COLUMNS = `
  id, code, name, sort_order, is_won, is_lost, stuck_threshold_days,
  is_active, created_at, updated_at, pipeline_id, probability`;

export async function GET(request: NextRequest) {
  const pipelineIdRaw = new URL(request.url).searchParams.get("pipeline_id");
  const pipelineId = pipelineIdRaw && /^[0-9a-f-]{36}$/i.test(pipelineIdRaw) ? pipelineIdRaw : null;
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    // Tahap nonaktif hanya relevan untuk layar konfigurasi (super_admin);
    // kanban semua role cukup tahap aktif.
    const includeAll =
      user.role === "super_admin" &&
      new URL(request.url).searchParams.get("all") === "1";

    const rows = await query(
      `SELECT ${STAGE_COLUMNS} FROM crm.crm_sales_stages
       WHERE ($1::uuid IS NULL OR pipeline_id = $1) ${includeAll ? "" : "AND is_active = true"}
       ORDER BY sort_order ASC, created_at ASC`,
      [pipelineId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list stages error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat tahap pipeline" },
      { status: 500 }
    );
  }
}

// EPIC-050 Fase 3: tambah tahap ke pipeline (admin/super_admin)
const createStageSchema = z.object({
  pipeline_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  sort_order: z.number().int().min(0).max(1000).optional(),
  probability: z.number().int().min(0).max(100).default(10),
  stuck_threshold_days: z.number().int().min(0).max(365).default(7),
});

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  if (user.role !== "super_admin" && user.role !== "admin") {
    return NextResponse.json({ success: false, error: "Hanya admin/super admin" }, { status: 403 });
  }
  const parsed = createStageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const pipeline = await queryOne<{ code: string }>(`SELECT code FROM crm.crm_pipelines WHERE id = $1`, [b.pipeline_id]);
  if (!pipeline) return NextResponse.json({ success: false, error: "Pipeline tidak ditemukan" }, { status: 404 });
  const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 30);
  const code = `${pipeline.code}-${slug}-${Date.now().toString(36)}`;
  const sortOrder =
    b.sort_order ??
    Number((await queryOne<{ n: string }>(`SELECT COALESCE(max(sort_order), 0) AS n FROM crm.crm_sales_stages WHERE pipeline_id = $1 AND NOT is_won AND NOT is_lost`, [b.pipeline_id]))?.n ?? 0) + 10;
  // tahap baru selalu sebelum Menang/Kalah
  await queryOne(`UPDATE crm.crm_sales_stages SET sort_order = sort_order + 20 WHERE pipeline_id = $1 AND (is_won OR is_lost) AND sort_order <= $2`, [b.pipeline_id, sortOrder]);
  const row = await queryOne(
    `INSERT INTO crm.crm_sales_stages (code, name, sort_order, probability, stuck_threshold_days, pipeline_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${STAGE_COLUMNS}`,
    [code, b.name, sortOrder, b.probability, b.stuck_threshold_days, b.pipeline_id]
  );
  return createdResponse(row, "Tahap ditambahkan");
}
