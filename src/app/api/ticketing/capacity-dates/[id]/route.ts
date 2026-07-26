import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { requireTicketingContext } from "@/lib/ticketing/server";

// EPIC-031 A3 — edit/hapus satu override kapasitas. Hard delete sah:
// baris murni konfigurasi, tidak ada FK yang menunjuk ke sini.

interface CapacityDateRow {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  capacity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const CAPACITY_DATE_COLUMNS = `id, label, start_date::text AS start_date,
  end_date::text AS end_date, capacity, is_active, created_at, updated_at`;

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  start_date: z
    .string()
    .refine(isValidCalendarDate, "Tanggal mulai tidak valid")
    .optional(),
  end_date: z
    .string()
    .refine(isValidCalendarDate, "Tanggal akhir tidak valid")
    .optional(),
  capacity: z.number().int().min(0).max(1_000_000).optional(),
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
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const current = await queryOne<CapacityDateRow>(
      `SELECT ${CAPACITY_DATE_COLUMNS}
       FROM ticketing.ticket_capacity_dates
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Override kapasitas tidak ditemukan" },
        { status: 404 }
      );
    }

    // Validasi rentang pakai nilai FINAL (gabungan lama + patch) — patch
    // sebagian tidak boleh menghasilkan end < start
    const finalStart = body.start_date ?? current.start_date;
    const finalEnd = body.end_date ?? current.end_date;
    if (finalEnd < finalStart) {
      return NextResponse.json(
        { success: false, error: "Tanggal akhir tidak boleh sebelum tanggal mulai" },
        { status: 400 }
      );
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.label !== undefined) add("label", body.label);
    if (body.start_date !== undefined) add("start_date", body.start_date);
    if (body.end_date !== undefined) add("end_date", body.end_date);
    if (body.capacity !== undefined) add("capacity", body.capacity);
    if (body.is_active !== undefined) add("is_active", body.is_active);

    values.push(id, ctx.branchId, ctx.companyId);
    const rows = await query<CapacityDateRow>(
      `UPDATE ticketing.ticket_capacity_dates SET ${sets.join(", ")}
       WHERE id = $${values.length - 2} AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}
       RETURNING ${CAPACITY_DATE_COLUMNS}`,
      values
    );
    return successResponse(rows[0], "Override kapasitas diperbarui");
  } catch (err) {
    console.error("[ticketing] update capacity date error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui override kapasitas" },
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
    const rows = await query<{ id: string }>(
      `DELETE FROM ticketing.ticket_capacity_dates
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
       RETURNING id`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Override kapasitas tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse({ id }, "Override kapasitas dihapus");
  } catch (err) {
    console.error("[ticketing] delete capacity date error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus override kapasitas" },
      { status: 500 }
    );
  }
}
