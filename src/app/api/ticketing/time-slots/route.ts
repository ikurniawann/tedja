import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

// EPIC-031 Fase D — CRUD template slot waktu (timed-entry) level venue.
// Admin (super_admin) — selaras Pengaturan Tiket. Hapus/nonaktif template
// TIDAK mengubah booking lama (label+jam di-snapshot ke booking).

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

export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const rows = await query<TimeSlotRow>(
      `SELECT ${SLOT_COLUMNS} FROM ticketing.ticket_time_slots
       WHERE branch_id = $1 AND company_id = $2
       ORDER BY sort_order, start_time`,
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[ticketing] list time slots error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat slot waktu" },
      { status: 500 }
    );
  }
}

const createSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    start_time: z.string().regex(TIME_PATTERN, "Format jam HH:MM"),
    end_time: z.string().regex(TIME_PATTERN, "Format jam HH:MM"),
    // null = tanpa batas per-slot (jendela jam saja; kuota harian tetap)
    capacity: z.number().int().min(1).max(1_000_000).nullable().default(null),
    sort_order: z.number().int().min(0).max(1000).default(0),
  })
  .refine((b) => b.end_time > b.start_time, {
    message: "Jam selesai harus setelah jam mulai",
    path: ["end_time"],
  });

export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const rows = await query<TimeSlotRow>(
      `INSERT INTO ticketing.ticket_time_slots
         (company_id, branch_id, label, start_time, end_time, capacity,
          sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SLOT_COLUMNS}`,
      [
        ctx.companyId,
        ctx.branchId,
        body.label,
        body.start_time,
        body.end_time,
        body.capacity,
        body.sort_order,
        ctx.user.id,
      ]
    );
    return successResponse(rows[0], "Slot waktu ditambahkan");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Label slot sudah dipakai — pilih label lain" },
        { status: 409 }
      );
    }
    console.error("[ticketing] create time slot error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menambah slot waktu" },
      { status: 500 }
    );
  }
}
