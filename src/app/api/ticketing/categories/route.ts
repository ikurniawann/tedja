import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

interface CategoryRow {
  id: string;
  name: string;
}

/** Daftar kategori utk autocomplete (filter q, maksimal 20). */
export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const params: unknown[] = [ctx.branchId, ctx.companyId];
    let where = "branch_id = $1 AND company_id = $2";
    if (q) {
      params.push(`%${q}%`);
      where += ` AND name ILIKE $${params.length}`;
    }
    const rows = await query<CategoryRow>(
      `SELECT id, name FROM ticketing.ticket_categories
       WHERE ${where}
       ORDER BY name
       LIMIT 20`,
      params
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[ticketing] list categories error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat kategori" },
      { status: 500 }
    );
  }
}

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

/**
 * Auto-add kategori dari autocomplete: bila nama sudah ada (case-insensitive)
 * kembalikan baris existing — submit tidak pernah gagal karena duplikat.
 */
export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = createCategorySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Nama kategori wajib diisi" },
        { status: 400 }
      );
    }
    const name = parsed.data.name;

    const existing = await queryOne<CategoryRow>(
      `SELECT id, name FROM ticketing.ticket_categories
       WHERE branch_id = $1 AND company_id = $2 AND lower(name) = lower($3)`,
      [ctx.branchId, ctx.companyId, name]
    );
    if (existing) return successResponse(existing);

    const rows = await query<CategoryRow>(
      `INSERT INTO ticketing.ticket_categories
         (company_id, branch_id, name, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (branch_id, lower(name)) DO UPDATE SET updated_at = now()
       RETURNING id, name`,
      [ctx.companyId, ctx.branchId, name, ctx.user.id]
    );
    return successResponse(rows[0], "Kategori ditambahkan");
  } catch (err) {
    console.error("[ticketing] create category error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menambah kategori" },
      { status: 500 }
    );
  }
}
