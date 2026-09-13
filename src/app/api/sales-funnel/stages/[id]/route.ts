import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const updateStageSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  stuck_threshold_days: z.number().int().min(0).max(365).optional(),
  is_active: z.boolean().optional(),
  // EPIC-050 Fase 3
  probability: z.number().int().min(0).max(100).optional(),
});

type StageRow = {
  id: string;
  is_won: boolean;
  is_lost: boolean;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  // Konfigurasi tahap = wewenang Super Admin (keputusan owner EPIC-022)
  if (user.role !== "super_admin") {
    return NextResponse.json(
      { success: false, error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const stage = await queryOne<StageRow>(
      `SELECT id, is_won, is_lost FROM crm.crm_sales_stages WHERE id = $1`,
      [id]
    );
    if (!stage) {
      return NextResponse.json(
        { success: false, error: "Tahap tidak ditemukan" },
        { status: 404 }
      );
    }

    const parsed = updateStageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    if (body.is_active === false) {
      if (stage.is_won || stage.is_lost) {
        return NextResponse.json(
          { success: false, error: "Tahap Menang/Kalah tidak boleh dinonaktifkan" },
          { status: 400 }
        );
      }
      const openDeal = await queryOne<{ id: string }>(
        `SELECT id FROM crm.crm_sales_deals
         WHERE stage_id = $1 AND deleted_at IS NULL AND closed_at IS NULL
         LIMIT 1`,
        [id]
      );
      if (openDeal) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Masih ada deal berjalan di tahap ini — pindahkan dulu sebelum menonaktifkan",
          },
          { status: 400 }
        );
      }
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(body)) {
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
      `UPDATE crm.crm_sales_stages SET ${sets.join(", ")}
       WHERE id = $${values.length}
       RETURNING id, code, name, sort_order, is_won, is_lost,
                 stuck_threshold_days, is_active`,
      values
    );
    return successResponse(row, "Tahap diperbarui");
  } catch (err) {
    console.error("[sales-funnel] update stage error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui tahap" },
      { status: 500 }
    );
  }
}
