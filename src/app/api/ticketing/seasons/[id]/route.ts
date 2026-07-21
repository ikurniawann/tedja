import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { requireTicketingContext } from "@/lib/ticketing/server";

const SEASON_COLUMNS = `id, name, season_kind, start_date::text AS start_date,
  end_date::text AS end_date, is_active, created_at, updated_at`;

const dateSchema = z
  .string()
  .refine(isValidCalendarDate, "Tanggal tidak valid (YYYY-MM-DD)");

const updateSeasonSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    start_date: dateSchema.optional(),
    end_date: dateSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) => !v.start_date || !v.end_date || v.end_date >= v.start_date,
    { message: "Tanggal akhir harus ≥ tanggal mulai", path: ["end_date"] }
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateSeasonSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // Patch parsial bisa membalik rentang (ubah satu ujung saja) —
    // validasi terhadap nilai existing sebelum UPDATE agar pesan ramah,
    // bukan error constraint DB.
    if (body.start_date !== undefined || body.end_date !== undefined) {
      const existing = await query<{ start_date: string; end_date: string }>(
        `SELECT start_date::text AS start_date, end_date::text AS end_date
         FROM ticketing.ticket_seasons
         WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
        [id, ctx.branchId, ctx.companyId]
      );
      if (existing.length === 0) {
        return NextResponse.json(
          { success: false, error: "Musim tidak ditemukan" },
          { status: 404 }
        );
      }
      const effectiveStart = body.start_date ?? existing[0].start_date;
      const effectiveEnd = body.end_date ?? existing[0].end_date;
      if (effectiveEnd < effectiveStart) {
        return NextResponse.json(
          { success: false, error: "Tanggal akhir harus ≥ tanggal mulai" },
          { status: 400 }
        );
      }
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.name !== undefined) add("name", body.name);
    if (body.start_date !== undefined) add("start_date", body.start_date);
    if (body.end_date !== undefined) add("end_date", body.end_date);
    if (body.is_active !== undefined) add("is_active", body.is_active);

    values.push(id, ctx.branchId, ctx.companyId);
    const rows = await query<{ start_date: string; end_date: string }>(
      `UPDATE ticketing.ticket_seasons SET ${sets.join(", ")}
       WHERE id = $${values.length - 2}
         AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}
       RETURNING ${SEASON_COLUMNS}`,
      values
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Musim tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse(rows[0], "Musim diperbarui");
  } catch (err) {
    console.error("[ticketing] update season error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui musim (cek rentang tanggal)" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const rows = await query(
      `DELETE FROM ticketing.ticket_seasons
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
       RETURNING id`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Musim tidak ditemukan" },
        { status: 404 }
      );
    }
    return noContentResponse();
  } catch (err) {
    console.error("[ticketing] delete season error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus musim" },
      { status: 500 }
    );
  }
}
