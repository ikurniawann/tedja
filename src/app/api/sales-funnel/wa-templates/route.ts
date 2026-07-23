import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(2000),
});

export async function GET() {
  const { error } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    // Template global (company_id NULL) — kelola khusus super_admin,
    // dipakai semua venue. Template per-company menyusul bila dibutuhkan.
    const rows = await query(
      `SELECT id, name, body, is_active, created_at
       FROM crm.crm_sales_wa_templates
       WHERE is_active = true
       ORDER BY name ASC`
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list wa templates error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat template pesan" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  if (user.role !== "super_admin") {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  try {
    const parsed = createTemplateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const row = await queryOne(
      `INSERT INTO crm.crm_sales_wa_templates (name, body, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, body, is_active`,
      [parsed.data.name, parsed.data.body, user.id]
    );
    return createdResponse(row, "Template dibuat");
  } catch (err) {
    console.error("[sales-funnel] create wa template error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat template" },
      { status: 500 }
    );
  }
}
