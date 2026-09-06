import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { FOLIO_CHARGE_TYPES, chargeDirection, folioTotals, type FolioChargeType } from "@/lib/resort/reservation";
import { requireResortContext } from "@/lib/resort/server";

/**
 * POST /api/resort/reservations/[id]/charges — tambah baris folio: biaya
 * (F&B, aktivitas, laundry, denda) atau pembayaran/diskon. Arah debit/kredit
 * ditentukan jenisnya supaya kasir tidak bisa salah tanda.
 */
const schema = z.object({
  charge_type: z.enum(FOLIO_CHARGE_TYPES),
  description: z.string().trim().min(2).max(200),
  amount: z.number().positive().max(1_000_000_000),
  payment_method: z.string().trim().max(30).optional().nullable(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext("update");
    const { id } = await params;
    const body = await validateBody(request, schema);
    const reservation = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM resort.reservations WHERE id = $1 AND branch_id = $2`, [id, ctx.branchId]
    );
    if (!reservation) throw ApiError.notFound("Reservasi tidak ditemukan");
    if (reservation.status === "dibatalkan") throw ApiError.conflict("Reservasi sudah dibatalkan");

    const actor = await queryOne<{ full_name: string | null }>(
      `SELECT full_name FROM configuration.users WHERE id = $1`, [ctx.user.id]
    );
    const direction = chargeDirection(body.charge_type as FolioChargeType);
    const rows = await query(
      `INSERT INTO resort.folio_charges
         (company_id, branch_id, reservation_id, charge_type, direction, description, amount, payment_method, created_by, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, charge_type, direction, description, amount::float8 AS amount, created_at`,
      [ctx.companyId, ctx.branchId, id, body.charge_type, direction, body.description, body.amount,
       body.payment_method ?? null, ctx.user.id, actor?.full_name?.trim() || "Front Office"]
    );
    const folio = await query<{ direction: "debit" | "kredit"; amount: number }>(
      `SELECT direction, amount::float8 AS amount FROM resort.folio_charges WHERE reservation_id = $1`, [id]
    );
    const totals = folioTotals(folio);
    return NextResponse.json({
      success: true,
      data: { charge: rows[0], totals },
      message: direction === "kredit"
        ? `Pembayaran Rp ${Math.round(body.amount).toLocaleString("id-ID")} dicatat — sisa Rp ${Math.round(totals.balance).toLocaleString("id-ID")}`
        : `Biaya ${body.description} ditambahkan — saldo Rp ${Math.round(totals.balance).toLocaleString("id-ID")}`,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] folio charge:", error);
    return NextResponse.json({ success: false, error: "Gagal menambah baris folio" }, { status: 500 });
  }
}
