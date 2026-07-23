import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

const topupSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  method: z.enum(["cash", "qris", "card"]),
});

/** Top-up ulang saldo prepaid — bisa dari kasir mana pun selama visit open. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-topup:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak top-up — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    const parsed = topupSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = {
      ...parsed.data,
      // Bulatkan 2dp — ledger bebas noise pecahan sen
      amount: Math.round(parsed.data.amount * 100) / 100,
    };
    if (body.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "Nominal top-up harus > 0" },
        { status: 400 }
      );
    }

    await withTransaction(async (client) => {
      const visitResult = await client.query<{
        payment_mode: string;
        status: string;
      }>(
        `SELECT payment_mode, status FROM ticketing.ticket_visits
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
          new Error("Kunjungan sudah ditutup — top-up tidak bisa"),
          { statusCode: 409 }
        );
      }
      if (visit.payment_mode !== "prepaid") {
        throw Object.assign(
          new Error("Top-up hanya untuk kunjungan mode prepaid"),
          { statusCode: 400 }
        );
      }

      await client.query(
        `INSERT INTO ticketing.ticket_visit_charges
           (company_id, branch_id, visit_id, charge_type, direction,
            description, amount, payment_method, created_by)
         VALUES ($1, $2, $3, 'deposit', 'kredit', $4, $5, $6, $7)`,
        [
          ctx.companyId,
          ctx.branchId,
          id,
          `Top-up deposit (${body.method})`,
          body.amount,
          body.method,
          ctx.user.id,
        ]
      );
    });

    return successResponse({ id }, "Top-up tersimpan");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] topup error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan top-up" },
      { status: 500 }
    );
  }
}
