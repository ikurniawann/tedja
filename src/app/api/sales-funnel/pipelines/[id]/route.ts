import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const schema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  is_default: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  if (user.role !== "super_admin" && user.role !== "admin") {
    return NextResponse.json({ success: false, error: "Hanya admin/super admin" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await queryOne<{ id: string }>(`SELECT id FROM crm.crm_pipelines WHERE id = $1`, [id]);
  if (!existing) return NextResponse.json({ success: false, error: "Pipeline tidak ditemukan" }, { status: 404 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  if (b.is_default) await query(`UPDATE crm.crm_pipelines SET is_default = false WHERE id <> $1`, [id]);
  if (b.is_active === false) {
    const open = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM crm.crm_sales_deals WHERE pipeline_id = $1 AND deleted_at IS NULL AND closed_at IS NULL`, [id]);
    if (Number(open?.n ?? 0) > 0) {
      return NextResponse.json({ success: false, error: "Pipeline masih punya deal terbuka — pindahkan dulu" }, { status: 409 });
    }
  }
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    values.push(v);
    sets.push(`${k} = $${values.length}`);
  }
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  values.push(id);
  const row = await queryOne(`UPDATE crm.crm_pipelines SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, code, name, is_default, is_active`, values);
  return successResponse(row, "Pipeline diperbarui");
}
