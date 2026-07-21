import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, paginatedResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  BAND_STATUSES,
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
} from "@/lib/ticketing/server";

const BAND_COLUMNS = `id, nfc_uid, label, status, created_at, updated_at`;

export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const status = url.searchParams.get("status") ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));

    const conditions: string[] = ["branch_id = $1", "company_id = $2"];
    const params: unknown[] = [ctx.branchId, ctx.companyId];
    if (status && (BAND_STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(
        `(nfc_uid ILIKE $${params.length} OR label ILIKE $${params.length})`
      );
    }

    params.push(limit, (page - 1) * limit);
    const rows = await query<Record<string, unknown> & { total_count: string }>(
      `SELECT ${BAND_COLUMNS}, COUNT(*) OVER() AS total_count
       FROM ticketing.ticket_bands
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const data = rows.map((row) => {
      const { total_count, ...band } = row;
      void total_count;
      return band;
    });
    return paginatedResponse(data, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[ticketing] list bands error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat registry gelang" },
      { status: 500 }
    );
  }
}

const createBandSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  label: z.string().trim().max(60).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = createBandSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const uid = normalizeNfcUid(parsed.data.nfc_uid);
    if (!isValidNfcUid(uid)) {
      return NextResponse.json(
        { success: false, error: "UID gelang tidak valid — scan ulang kartu/gelang" },
        { status: 400 }
      );
    }

    const duplicate = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM ticketing.ticket_bands
       WHERE branch_id = $1 AND nfc_uid = $2`,
      [ctx.branchId, uid]
    );
    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          error: `Gelang sudah terdaftar (status: ${duplicate.status})`,
        },
        { status: 409 }
      );
    }

    const row = await queryOne(
      `INSERT INTO ticketing.ticket_bands
         (company_id, branch_id, nfc_uid, label, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${BAND_COLUMNS}`,
      [ctx.companyId, ctx.branchId, uid, parsed.data.label || null, ctx.user.id]
    );
    return createdResponse(row, "Gelang terdaftar");
  } catch (err) {
    console.error("[ticketing] create band error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mendaftarkan gelang" },
      { status: 500 }
    );
  }
}
