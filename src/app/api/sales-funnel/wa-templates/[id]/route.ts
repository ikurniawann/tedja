import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
});

async function requireSuperAdmin() {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return { error, user: null };
  if (user.role !== "super_admin") {
    return {
      error: NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      ),
      user: null,
    };
  }
  return { error: null, user };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateTemplateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    if (values.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }

    values.push(id);
    const row = await queryOne(
      `UPDATE crm.crm_sales_wa_templates SET ${sets.join(", ")}
       WHERE id = $${values.length} AND is_active = true
       RETURNING id, name, body, is_active`,
      values
    );
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Template tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(row, "Template diperbarui");
  } catch (err) {
    console.error("[sales-funnel] update wa template error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui template" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireSuperAdmin();
  if (error) return error;

  try {
    const { id } = await params;
    // Nonaktifkan, bukan hapus — riwayat kirim tetap bisa dirunut
    const row = await queryOne(
      `UPDATE crm.crm_sales_wa_templates
       SET is_active = false, updated_at = now()
       WHERE id = $1 AND is_active = true RETURNING id`,
      [id]
    );
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Template tidak ditemukan" },
        { status: 404 }
      );
    }
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete wa template error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus template" },
      { status: 500 }
    );
  }
}
