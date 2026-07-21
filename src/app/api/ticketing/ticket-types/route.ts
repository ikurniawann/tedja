import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

const TYPE_COLUMNS = `id, code, name, rule_note, sort_order, is_active,
  created_at, updated_at`;

const createTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Kode hanya huruf kecil, angka, dan tanda hubung"),
  name: z.string().trim().min(1).max(100),
  rule_note: z.string().trim().max(300).optional().nullable(),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const rows = await query(
      `SELECT ${TYPE_COLUMNS} FROM ticketing.ticket_types
       WHERE branch_id = $1 AND company_id = $2
       ORDER BY sort_order, name`,
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[ticketing] list ticket types error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat jenis tiket" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = createTypeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const duplicate = await queryOne(
      `SELECT id FROM ticketing.ticket_types
       WHERE branch_id = $1 AND code = $2`,
      [ctx.branchId, body.code]
    );
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: `Kode jenis tiket "${body.code}" sudah dipakai` },
        { status: 409 }
      );
    }

    const row = await queryOne(
      `INSERT INTO ticketing.ticket_types
         (company_id, branch_id, code, name, rule_note, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${TYPE_COLUMNS}`,
      [
        ctx.companyId,
        ctx.branchId,
        body.code,
        body.name,
        body.rule_note || null,
        body.sort_order,
        ctx.user.id,
      ]
    );
    return createdResponse(row, "Jenis tiket dibuat");
  } catch (err) {
    console.error("[ticketing] create ticket type error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat jenis tiket" },
      { status: 500 }
    );
  }
}
