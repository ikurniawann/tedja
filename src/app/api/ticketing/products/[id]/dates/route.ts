import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";

const createDateSchema = z.object({
  date_kind: z.enum(["high-season", "blok-online"]),
  label: z.string().trim().min(1).max(120),
  start_date: z.string(),
  end_date: z.string(),
});

/** Tambah rentang kalender ticket: high season atau blok penjualan online. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = createDateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    if (
      !isValidCalendarDate(body.start_date) ||
      !isValidCalendarDate(body.end_date) ||
      body.end_date < body.start_date
    ) {
      return NextResponse.json(
        { success: false, error: "Rentang tanggal tidak valid" },
        { status: 400 }
      );
    }

    const product = await queryOne<{ id: string }>(
      `SELECT id FROM ticketing.ticket_products
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [id, ctx.branchId, ctx.companyId]
    );
    if (!product) {
      return NextResponse.json(
        { success: false, error: "Ticket tidak ditemukan" },
        { status: 404 }
      );
    }

    const rows = await query<{ id: string }>(
      `INSERT INTO ticketing.ticket_product_dates
         (company_id, branch_id, ticket_product_id, date_kind, label,
          start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        ctx.companyId,
        ctx.branchId,
        id,
        body.date_kind,
        body.label,
        body.start_date,
        body.end_date,
        ctx.user.id,
      ]
    );
    return successResponse(rows[0], "Rentang tanggal ditambahkan");
  } catch (err) {
    console.error("[ticketing] create product date error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menambah rentang tanggal" },
      { status: 500 }
    );
  }
}
