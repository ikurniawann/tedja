import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

// EPIC-031 Fase D — edit/hapus satu slot waktu. Hard delete sah: FK
// booking ON DELETE SET NULL + snapshot label/jam tetap utuh di booking.

interface TimeSlotRow {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  capacity: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const SLOT_COLUMNS = `id, label, start_time::text AS start_time,
  end_time::text AS end_time, capacity, sort_order, is_active,
  created_at, updated_at`;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const patchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  start_time: z.string().regex(TIME_PATTERN, "Format jam HH:MM").optional(),
  end_time: z.string().regex(TIME_PATTERN, "Format jam HH:MM").optional(),
  capacity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
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

    const current = await queryOne<TimeSlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM ticketing.ticket_time_slots
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!current) {
      return NextResponse.json(
        { success: false, error: "Slot waktu tidak ditemukan" },
        { status: 404 }
      );
    }

    // Validasi jendela pakai nilai FINAL (gabungan lama + patch)
    const finalStart = body.start_time ?? current.start_time.slice(0, 5);
    const finalEnd = body.end_time ?? current.end_time.slice(0, 5);
    if (finalEnd <= finalStart) {
      return NextResponse.json(
        { success: false, error: "Jam selesai harus setelah jam mulai" },
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
    if (body.start_time !== undefined) add("start_time", body.start_time);
    if (body.end_time !== undefined) add("end_time", body.end_time);
    if (body.capacity !== undefined) add("capacity", body.capacity);
    if (body.sort_order !== undefined) add("sort_order", body.sort_order);
    if (body.is_active !== undefined) add("is_active", body.is_active);

    values.push(id, ctx.branchId, ctx.companyId);
    const rows = await query<TimeSlotRow>(
      `UPDATE ticketing.ticket_time_slots SET ${sets.join(", ")}
       WHERE id = $${values.length - 2} AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}
       RETURNING ${SLOT_COLUMNS}`,
      values
    );
    return successResponse(rows[0], "Slot waktu diperbarui");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Label slot sudah dipakai — pilih label lain" },
        { status: 409 }
      );
    }
    console.error("[ticketing] update time slot error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui slot waktu" },
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
      `DELETE FROM ticketing.ticket_time_slots
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
       RETURNING id`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Slot waktu tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse({ id }, "Slot waktu dihapus");
  } catch (err) {
    console.error("[ticketing] delete time slot error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus slot waktu" },
      { status: 500 }
    );
  }
}
