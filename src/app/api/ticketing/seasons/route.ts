import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import { requireTicketingContext } from "@/lib/ticketing/server";

const SEASON_COLUMNS = `id, name, season_kind, start_date::text AS start_date,
  end_date::text AS end_date, is_active, created_at, updated_at`;

const dateSchema = z
  .string()
  .refine(isValidCalendarDate, "Tanggal tidak valid (YYYY-MM-DD)");

const createSeasonSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    start_date: dateSchema,
    end_date: dateSchema,
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "Tanggal akhir harus ≥ tanggal mulai",
    path: ["end_date"],
  });

export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const rows = await query(
      `SELECT ${SEASON_COLUMNS} FROM ticketing.ticket_seasons
       WHERE branch_id = $1 AND company_id = $2
       ORDER BY start_date DESC`,
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[ticketing] list seasons error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat kalender musim" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = createSeasonSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // High season baru boleh menumpuk dengan yang lama (union rentang),
    // jadi tidak ada validasi overlap — resolver memenangkan `high`.
    const row = await queryOne(
      `INSERT INTO ticketing.ticket_seasons
         (company_id, branch_id, name, season_kind, start_date, end_date, created_by)
       VALUES ($1, $2, $3, 'high', $4, $5, $6)
       RETURNING ${SEASON_COLUMNS}`,
      [
        ctx.companyId,
        ctx.branchId,
        body.name,
        body.start_date,
        body.end_date,
        ctx.user.id,
      ]
    );
    return createdResponse(row, "Musim ditambahkan");
  } catch (err) {
    console.error("[ticketing] create season error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menambah musim" },
      { status: 500 }
    );
  }
}
