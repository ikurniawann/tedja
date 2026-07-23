import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";
import { computeTabSummary, settlementPlan } from "@/lib/ticketing/tab";
import type { PoolClient } from "pg";

const CASH_METHODS = ["cash", "qris", "card"] as const;

const settleSchema = z.object({
  // settle satu gelang saja (postpaid) — kosong = tutup seluruh rombongan
  visit_band_id: z.string().uuid().optional().nullable(),
  payments: z
    .array(
      z.object({
        method: z.enum(CASH_METHODS),
        amount: z.number().positive().max(1_000_000_000),
      })
    )
    .max(5)
    .optional(),
  refund_method: z.enum(CASH_METHODS).optional(),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

class SettleError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function loadCharges(client: PoolClient, visitId: string) {
  const result = await client.query<{
    band_id: string | null;
    direction: "debit" | "kredit";
    amount: string;
  }>(
    `SELECT band_id, direction, amount
     FROM ticketing.ticket_visit_charges
     WHERE visit_id = $1`,
    [visitId]
  );
  return result.rows.map((row) => ({
    band_id: row.band_id,
    direction: row.direction,
    amount: Number(row.amount),
  }));
}

/**
 * Settlement kasir keluar — transaksional & atomik:
 * - Tanpa visit_band_id: tutup seluruh rombongan (postpaid bayar total;
 *   prepaid refund sisa saldo / tagih kekurangan), release semua gelang,
 *   visit → settled.
 * - Dengan visit_band_id (postpaid saja): bayar tagihan satu gelang,
 *   release gelang itu; visit tetap open selama masih ada gelang aktif
 *   atau ledger belum seimbang.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-settle:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak settlement — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    const parsed = settleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;
    // Bulatkan tiap baris — ledger bebas noise pecahan sen
    const payments = (body.payments ?? []).map((p) => ({
      ...p,
      amount: round2(p.amount),
    }));
    const paidTotal = round2(payments.reduce((sum, p) => sum + p.amount, 0));

    const result = await withTransaction(async (client) => {
      // Kunci visit — serialisasi terhadap gate tap / charge F&B / settle lain
      const visitResult = await client.query<{
        payment_mode: "postpaid" | "prepaid";
        status: string;
      }>(
        `SELECT payment_mode, status FROM ticketing.ticket_visits
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      const visit = visitResult.rows[0];
      if (!visit) throw new SettleError("Kunjungan tidak ditemukan", 404);
      if (visit.status !== "open") {
        throw new SettleError("Kunjungan sudah ditutup", 409);
      }

      const charges = await loadCharges(client, id);

      // ---------- Settle per gelang (postpaid) ----------
      if (body.visit_band_id) {
        if (visit.payment_mode === "prepaid") {
          throw new SettleError(
            "Mode prepaid di-settle satu rombongan sekaligus (refund sisa saldo)",
            400
          );
        }
        const vbResult = await client.query<{
          id: string;
          band_id: string;
          status: string;
        }>(
          `SELECT id, band_id, status FROM ticketing.ticket_visit_bands
           WHERE id = $1 AND visit_id = $2
           FOR UPDATE`,
          [body.visit_band_id, id]
        );
        const visitBand = vbResult.rows[0];
        if (!visitBand) {
          throw new SettleError("Gelang tidak ada di kunjungan ini", 404);
        }
        if (visitBand.status !== "aktif") {
          throw new SettleError("Gelang sudah di-settle / tidak aktif", 409);
        }

        const bandSummary = computeTabSummary(
          charges.filter((c) => c.band_id === visitBand.band_id)
        );
        const due = round2(bandSummary.outstanding);
        if (due <= 0 && paidTotal > 0) {
          throw new SettleError(
            "Gelang ini tidak punya tagihan — pembayaran tidak diperlukan",
            400
          );
        }
        if (due > 0 && paidTotal !== due) {
          throw new SettleError(
            `Nominal pembayaran (Rp${paidTotal.toLocaleString("id-ID")}) harus pas Rp${due.toLocaleString("id-ID")}`,
            400
          );
        }
        if (due > 0) {
          for (const payment of payments) {
            await client.query(
              `INSERT INTO ticketing.ticket_visit_charges
                 (company_id, branch_id, visit_id, band_id, charge_type,
                  direction, description, amount, payment_method, created_by)
               VALUES ($1, $2, $3, $4, 'pembayaran', 'kredit', $5, $6, $7, $8)`,
              [
                ctx.companyId,
                ctx.branchId,
                id,
                visitBand.band_id,
                `Pembayaran settle gelang (${payment.method})`,
                payment.amount,
                payment.method,
                ctx.user.id,
              ]
            );
          }
        }

        await client.query(
          `UPDATE ticketing.ticket_visit_bands
           SET status = 'selesai', updated_at = now() WHERE id = $1`,
          [visitBand.id]
        );
        await client.query(
          `UPDATE ticketing.ticket_bands
           SET status = 'tersedia', updated_at = now()
           WHERE id = $1 AND status = 'dipakai'`,
          [visitBand.band_id]
        );

        // Tutup visit otomatis bila tidak ada gelang aktif & ledger seimbang
        const remaining = await client.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM ticketing.ticket_visit_bands
           WHERE visit_id = $1 AND status = 'aktif'`,
          [id]
        );
        const afterCharges = await loadCharges(client, id);
        const afterSummary = computeTabSummary(afterCharges);
        let closed = false;
        if (Number(remaining.rows[0].n) === 0 && afterSummary.outstanding === 0) {
          await client.query(
            `UPDATE ticketing.ticket_visits
             SET status = 'settled', settled_at = now(), settled_by = $2,
                 updated_at = now()
             WHERE id = $1`,
            [id, ctx.user.id]
          );
          closed = true;
        }
        return { mode: "per-gelang" as const, paid: due, closed };
      }

      // ---------- Settle seluruh rombongan ----------
      const summary = computeTabSummary(charges);
      const plan = settlementPlan(summary);

      if (plan.amountDue > 0 && paidTotal !== plan.amountDue) {
        throw new SettleError(
          `Nominal pembayaran (Rp${paidTotal.toLocaleString("id-ID")}) harus pas Rp${plan.amountDue.toLocaleString("id-ID")}`,
          400
        );
      }
      if (plan.amountDue === 0 && paidTotal > 0) {
        throw new SettleError("Tidak ada tagihan — pembayaran tidak diperlukan", 400);
      }

      for (const payment of payments) {
        await client.query(
          `INSERT INTO ticketing.ticket_visit_charges
             (company_id, branch_id, visit_id, charge_type, direction,
              description, amount, payment_method, created_by)
           VALUES ($1, $2, $3, 'pembayaran', 'kredit', $4, $5, $6, $7)`,
          [
            ctx.companyId,
            ctx.branchId,
            id,
            `Pembayaran settlement (${payment.method})`,
            payment.amount,
            payment.method,
            ctx.user.id,
          ]
        );
      }
      if (plan.refundAmount > 0) {
        const refundMethod = body.refund_method ?? "cash";
        await client.query(
          `INSERT INTO ticketing.ticket_visit_charges
             (company_id, branch_id, visit_id, charge_type, direction,
              description, amount, payment_method, created_by)
           VALUES ($1, $2, $3, 'refund-deposit', 'debit', $4, $5, $6, $7)`,
          [
            ctx.companyId,
            ctx.branchId,
            id,
            `Refund sisa deposit (${refundMethod})`,
            plan.refundAmount,
            refundMethod,
            ctx.user.id,
          ]
        );
      }

      await client.query(
        `UPDATE ticketing.ticket_visits
         SET status = 'settled', settled_at = now(), settled_by = $2,
             updated_at = now()
         WHERE id = $1`,
        [id, ctx.user.id]
      );
      // Release semua gelang yang masih aktif (gelang hilang tetap hilang)
      await client.query(
        `UPDATE ticketing.ticket_bands b
         SET status = 'tersedia', updated_at = now()
         FROM ticketing.ticket_visit_bands vb
         WHERE vb.visit_id = $1 AND vb.band_id = b.id
           AND vb.status = 'aktif' AND b.status = 'dipakai'`,
        [id]
      );
      await client.query(
        `UPDATE ticketing.ticket_visit_bands
         SET status = 'selesai', updated_at = now()
         WHERE visit_id = $1 AND status = 'aktif'`,
        [id]
      );

      return {
        mode: "rombongan" as const,
        paid: plan.amountDue,
        refunded: plan.refundAmount,
        closed: true,
      };
    });

    return successResponse(result, "Settlement berhasil");
  } catch (err) {
    if (err instanceof SettleError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.statusCode }
      );
    }
    console.error("[ticketing] settle error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal melakukan settlement" },
      { status: 500 }
    );
  }
}
