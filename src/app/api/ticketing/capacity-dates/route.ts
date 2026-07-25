import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { requireTicketingContext } from "@/lib/ticketing/server";

// EPIC-031 A3 — override kapasitas harian per rentang tanggal (level VENUE).
// capacity 0 = tanggal tutup (online + walk-in); overlap antar rentang →
// resolver memakai kapasitas TERKECIL (lib/ticketing/capacity.ts).
// Admin venue (super_admin) — selaras Pengaturan Tiket.

// Route file hanya boleh meng-export handler — tipe/kolom tetap lokal
// (duplikat kecil di [id]/route.ts, disengaja).
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

export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const rows = await query<CapacityDateRow>(
      `SELECT ${CAPACITY_DATE_COLUMNS}
       FROM ticketing.ticket_capacity_dates
       WHERE branch_id = $1 AND company_id = $2
       ORDER BY start_date DESC, created_at DESC`,
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[ticketing] list capacity dates error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat override kapasitas" },
      { status: 500 }
    );
  }
}

const createSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    start_date: z
      .string()
      .refine(isValidCalendarDate, "Tanggal mulai tidak valid"),
    end_date: z
      .string()
      .refine(isValidCalendarDate, "Tanggal akhir tidak valid"),
    // 0 = tanggal tutup (superset blok-online, berlaku juga utk walk-in)
    capacity: z.number().int().min(0).max(1_000_000),
  })
  .refine((b) => b.end_date >= b.start_date, {
    message: "Tanggal akhir tidak boleh sebelum tanggal mulai",
    path: ["end_date"],
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

    const rows = await query<CapacityDateRow>(
      `INSERT INTO ticketing.ticket_capacity_dates
         (company_id, branch_id, label, start_date, end_date, capacity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${CAPACITY_DATE_COLUMNS}`,
      [
        ctx.companyId,
        ctx.branchId,
        body.label,
        body.start_date,
        body.end_date,
        body.capacity,
        ctx.user.id,
      ]
    );
    return successResponse(rows[0], "Override kapasitas ditambahkan");
  } catch (err) {
    console.error("[ticketing] create capacity date error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menambah override kapasitas" },
      { status: 500 }
    );
  }
}
