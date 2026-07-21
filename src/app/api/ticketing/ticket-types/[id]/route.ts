import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

const TYPE_COLUMNS = `id, code, name, rule_note, sort_order, is_active,
  created_at, updated_at`;

const updateTypeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  rule_note: z.string().trim().max(300).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateTypeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.rule_note !== undefined) add("rule_note", body.rule_note || null);
    if (body.sort_order !== undefined) add("sort_order", body.sort_order);
    if (body.is_active !== undefined) add("is_active", body.is_active);

    values.push(id, ctx.branchId, ctx.companyId);
    const rows = await query(
      `UPDATE ticketing.ticket_types SET ${sets.join(", ")}
       WHERE id = $${values.length - 2}
         AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}
       RETURNING ${TYPE_COLUMNS}`,
      values
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Jenis tiket tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(rows[0], "Jenis tiket diperbarui");
  } catch (err) {
    console.error("[ticketing] update ticket type error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui jenis tiket" },
      { status: 500 }
    );
  }
}
