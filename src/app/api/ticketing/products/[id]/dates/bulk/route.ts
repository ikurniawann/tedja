import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";
import { isValidCalendarDate } from "@/lib/ticketing/pricing";
import type { PoolClient } from "pg";

const bulkSchema = z.object({
  date_kind: z.enum(["high-season", "blok-online"]),
  /** Tanggal YYYY-MM-DD yang DICEKLIS (ditandai). */
  add: z.array(z.string()).max(100).default([]),
  /** Tanggal YYYY-MM-DD yang DI-UNCEKLIS (hapus tanda). */
  remove: z.array(z.string()).max(100).default([]),
});

const shiftDate = (iso: string, days: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

/**
 * Hapus tanda satu tanggal: baris sehari dihapus; tanggal di tengah
 * rentang lama (bentukan UI rentang sebelumnya) → rentang dibelah.
 */
async function removeDateMark(
  client: PoolClient,
  productId: string,
  dateKind: string,
  date: string
) {
  const ranges = await client.query<{
    id: string;
    label: string;
    start_date: string;
    end_date: string;
  }>(
    `SELECT id, label, start_date::text AS start_date, end_date::text AS end_date
     FROM ticketing.ticket_product_dates
     WHERE ticket_product_id = $1 AND date_kind = $2
       AND start_date <= $3 AND end_date >= $3`,
    [productId, dateKind, date]
  );

  for (const range of ranges.rows) {
    if (range.start_date === range.end_date) {
      await client.query(
        `DELETE FROM ticketing.ticket_product_dates WHERE id = $1`,
        [range.id]
      );
    } else if (range.start_date === date) {
      await client.query(
        `UPDATE ticketing.ticket_product_dates
         SET start_date = $2, updated_at = now() WHERE id = $1`,
        [range.id, shiftDate(date, 1)]
      );
    } else if (range.end_date === date) {
      await client.query(
        `UPDATE ticketing.ticket_product_dates
         SET end_date = $2, updated_at = now() WHERE id = $1`,
        [range.id, shiftDate(date, -1)]
      );
    } else {
      // Belah dua: [start, date-1] + [date+1, end]
      await client.query(
        `UPDATE ticketing.ticket_product_dates
         SET end_date = $2, updated_at = now() WHERE id = $1`,
        [range.id, shiftDate(date, -1)]
      );
      await client.query(
        `INSERT INTO ticketing.ticket_product_dates
           (company_id, branch_id, ticket_product_id, date_kind, label,
            start_date, end_date)
         SELECT company_id, branch_id, ticket_product_id, date_kind, label,
                $2, $3
         FROM ticketing.ticket_product_dates WHERE id = $1`,
        [range.id, shiftDate(date, 1), range.end_date]
      );
    }
  }
}

/**
 * Simpan hasil ceklis kalender bulanan (flow owner): tiap tanggal yang
 * diceklis jadi baris sehari; unceklis menghapus tanda (rentang lama
 * ikut dibelah bila perlu). Idempotent — tanggal yang sudah tertanda
 * tidak diduplikasi.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = bulkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    const allDates = [...body.add, ...body.remove];
    if (allDates.some((d) => !isValidCalendarDate(d))) {
      return NextResponse.json(
        { success: false, error: "Ada tanggal yang tidak valid" },
        { status: 400 }
      );
    }
    if (body.add.length === 0 && body.remove.length === 0) {
      return successResponse({ added: 0, removed: 0 });
    }

    await withTransaction(async (client) => {
      const product = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_products
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      if (product.rows.length === 0) {
        throw Object.assign(new Error("Ticket tidak ditemukan"), {
          statusCode: 404,
        });
      }

      for (const date of body.remove) {
        await removeDateMark(client, id, body.date_kind, date);
      }

      for (const date of [...new Set(body.add)]) {
        // Idempotent: lewati bila tanggal sudah tertanda kind yang sama
        const existing = await client.query(
          `SELECT 1 FROM ticketing.ticket_product_dates
           WHERE ticket_product_id = $1 AND date_kind = $2
             AND start_date <= $3 AND end_date >= $3
           LIMIT 1`,
          [id, body.date_kind, date]
        );
        if (existing.rows.length > 0) continue;
        await client.query(
          `INSERT INTO ticketing.ticket_product_dates
             (company_id, branch_id, ticket_product_id, date_kind, label,
              start_date, end_date, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
          [
            ctx.companyId,
            ctx.branchId,
            id,
            body.date_kind,
            date,
            date,
            ctx.user.id,
          ]
        );
      }
    });

    return successResponse(
      { added: body.add.length, removed: body.remove.length },
      "Kalender tersimpan"
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] bulk dates error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan kalender" },
      { status: 500 }
    );
  }
}
