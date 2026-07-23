import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireTicketingContext } from "@/lib/ticketing/server";
import type { UserRole } from "@/types";

// Void = wewenang supervisor — kasir biasa tidak boleh membalik tagihan.
const VOID_ROLES: UserRole[] = ["super_admin", "pos_supervisor"];

const voidSchema = z.object({
  reason: z.string().trim().min(3).max(200),
});

/**
 * Void baris tagihan (debit) di tab: tulis baris pembalik `koreksi`
 * ber-arah kredit dengan `voided_by_charge_id` menunjuk baris asal —
 * append-only, tidak pernah delete. Idempotent: baris yang sudah punya
 * pembalik ditolak.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chargeId: string }> }
) {
  const { error, ctx } = await requireTicketingContext(VOID_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-void:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak void — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id, chargeId } = await params;
    const parsed = voidSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Alasan void wajib diisi (min 3 karakter)" },
        { status: 400 }
      );
    }
    const reason = parsed.data.reason;

    await withTransaction(async (client) => {
      const visitResult = await client.query<{ status: string }>(
        `SELECT status FROM ticketing.ticket_visits
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      const visit = visitResult.rows[0];
      if (!visit) {
        throw Object.assign(new Error("Kunjungan tidak ditemukan"), {
          statusCode: 404,
        });
      }
      if (visit.status !== "open") {
        throw Object.assign(
          new Error("Kunjungan sudah ditutup — void lewat koreksi manual"),
          { statusCode: 409 }
        );
      }

      const chargeResult = await client.query<{
        id: string;
        band_id: string | null;
        charge_type: string;
        direction: string;
        description: string;
        amount: string;
      }>(
        `SELECT id, band_id, charge_type, direction, description, amount
         FROM ticketing.ticket_visit_charges
         WHERE id = $1 AND visit_id = $2`,
        [chargeId, id]
      );
      const charge = chargeResult.rows[0];
      if (!charge) {
        throw Object.assign(new Error("Baris tagihan tidak ditemukan"), {
          statusCode: 404,
        });
      }
      if (charge.direction !== "debit" || charge.charge_type === "refund-deposit") {
        throw Object.assign(
          new Error("Hanya baris tagihan (tiket/F&B/denda/koreksi) yang bisa di-void"),
          { statusCode: 400 }
        );
      }

      const reversed = await client.query(
        `SELECT 1 FROM ticketing.ticket_visit_charges
         WHERE voided_by_charge_id = $1 LIMIT 1`,
        [chargeId]
      );
      if (reversed.rows.length > 0) {
        throw Object.assign(new Error("Baris ini sudah pernah di-void"), {
          statusCode: 409,
        });
      }

      await client.query(
        `INSERT INTO ticketing.ticket_visit_charges
           (company_id, branch_id, visit_id, band_id, charge_type, direction,
            description, amount, voided_by_charge_id, created_by)
         VALUES ($1, $2, $3, $4, 'koreksi', 'kredit', $5, $6, $7, $8)`,
        [
          ctx.companyId,
          ctx.branchId,
          id,
          charge.band_id,
          `Void: ${charge.description} — ${reason}`,
          charge.amount,
          chargeId,
          ctx.user.id,
        ]
      );
    });

    return successResponse({ id: chargeId }, "Tagihan di-void");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] void charge error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mem-void tagihan" },
      { status: 500 }
    );
  }
}
