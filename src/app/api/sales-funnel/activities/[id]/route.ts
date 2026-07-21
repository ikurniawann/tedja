import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { findAccessibleActivity } from "@/lib/sales-funnel/access";
import {
  ACTIVITY_TYPES,
  requireSalesFunnelRole,
} from "@/lib/sales-funnel/server";

const updateActivitySchema = z.object({
  activity_type: z.enum(ACTIVITY_TYPES).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  is_done: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { activity, forbidden } = await findAccessibleActivity(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!activity) {
      return NextResponse.json(
        { success: false, error: "Aktivitas tidak ditemukan" },
        { status: 404 }
      );
    }

    const parsed = updateActivitySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { is_done, ...fields } = parsed.data;

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    if (is_done !== undefined) {
      values.push(is_done ? new Date().toISOString() : null);
      sets.push(`done_at = $${values.length}`);
    }
    if (values.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }

    values.push(id);
    const row = await queryOne(
      `UPDATE crm.crm_sales_activities SET ${sets.join(", ")}
       WHERE id = $${values.length}
       RETURNING id, activity_type, due_at, done_at`,
      values
    );
    return successResponse(row, "Aktivitas diperbarui");
  } catch (err) {
    console.error("[sales-funnel] update activity error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui aktivitas" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { activity, forbidden } = await findAccessibleActivity(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!activity) {
      return NextResponse.json(
        { success: false, error: "Aktivitas tidak ditemukan" },
        { status: 404 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_activities SET deleted_at = now(), updated_at = now()
       WHERE id = $1 RETURNING id`,
      [id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete activity error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus aktivitas" },
      { status: 500 }
    );
  }
}
