import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { termProgress } from "@/lib/sales-funnel/quotations";
import {
  isValidCalendarDate,
  requireSalesFunnelRole,
} from "@/lib/sales-funnel/server";

// EPIC-022 Fase G — pencatatan pembayaran per deal + progress pelunasan.
// Acuan tagihan (prioritas): quotation DITERIMA terbaru → nilai final deal
// (Menang) → estimasi. Termin ikut quotation acuan; status per termin
// diturunkan waterfall dari total pembayaran (kasir cukup catat nominal).

const PAYMENT_METHODS = ["cash", "transfer", "qris", "edc", "lainnya"] as const;

const createPaymentSchema = z.object({
  amount: z.number().positive().max(999_999_999_999),
  method: z.enum(PAYMENT_METHODS).default("transfer"),
  paid_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidCalendarDate, { message: "Tanggal tidak valid" }),
  note: z.string().trim().max(300).optional().nullable(),
});

interface ReferenceQuotationRow {
  id: string;
  quote_number: string;
  status: string;
  total: string;
}

async function loadPaymentSummary(dealId: string) {
  const [payments, refQuotation, deal] = await Promise.all([
    query<{
      id: string;
      amount: string;
      method: string;
      paid_on: string;
      note: string | null;
      created_by_name: string | null;
      created_at: string;
    }>(
      `SELECT p.id, p.amount, p.method, p.paid_on::text AS paid_on, p.note,
              u.full_name AS created_by_name, p.created_at
       FROM crm.crm_sales_deal_payments p
       LEFT JOIN configuration.users u ON u.id = p.created_by
       WHERE p.deal_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.paid_on DESC, p.created_at DESC`,
      [dealId]
    ),
    // Acuan: quotation diterima terbaru; belum ada → quotation terbaru
    queryOne<ReferenceQuotationRow>(
      `SELECT id, quote_number, status, total
       FROM crm.crm_sales_quotations
       WHERE deal_id = $1 AND deleted_at IS NULL
       ORDER BY (status = 'diterima') DESC, created_at DESC
       LIMIT 1`,
      [dealId]
    ),
    queryOne<{ value_final: string | null; value_estimate: string | null }>(
      `SELECT value_final, value_estimate FROM crm.crm_sales_deals WHERE id = $1`,
      [dealId]
    ),
  ]);

  const totalPaid =
    Math.round(payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100;

  // Tagihan acuan — quotation diterima menang atas angka deal
  const referenceTotal =
    refQuotation && refQuotation.status === "diterima"
      ? Number(refQuotation.total)
      : deal?.value_final !== null && deal?.value_final !== undefined
        ? Number(deal.value_final)
        : refQuotation
          ? Number(refQuotation.total)
          : Number(deal?.value_estimate ?? 0);

  const terms = refQuotation
    ? await query<{ label: string; percent: string; due_date: string | null }>(
        `SELECT label, percent, due_date::text AS due_date
         FROM crm.crm_sales_quotation_terms
         WHERE quotation_id = $1
         ORDER BY sort_order`,
        [refQuotation.id]
      )
    : [];

  return {
    payments: payments.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      method: p.method,
      paid_on: p.paid_on,
      note: p.note,
      created_by_name: p.created_by_name,
      created_at: p.created_at,
    })),
    summary: {
      reference_total: Math.round(referenceTotal * 100) / 100,
      reference_quote_number: refQuotation?.quote_number ?? null,
      reference_is_accepted: refQuotation?.status === "diterima",
      total_paid: totalPaid,
      outstanding: Math.max(
        0,
        Math.round((referenceTotal - totalPaid) * 100) / 100
      ),
    },
    terms: termProgress(
      terms.map((t) => ({
        label: t.label,
        due_date: t.due_date,
        percent: Number(t.percent),
      })),
      referenceTotal,
      totalPaid
    ),
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { deal, forbidden } = await findAccessibleDeal(id, user);
    if (forbidden || !deal) {
      return NextResponse.json(
        { success: false, error: forbidden ? "Insufficient permissions" : "Deal tidak ditemukan" },
        { status: forbidden ? 403 : 404 }
      );
    }
    return successResponse(await loadPaymentSummary(id));
  } catch (err) {
    console.error("[sales-funnel] list payments error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat pembayaran" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  const rate = checkRateLimit(`sales-payment:${user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pencatatan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    const { deal, forbidden } = await findAccessibleDeal(id, user);
    if (forbidden || !deal) {
      return NextResponse.json(
        { success: false, error: forbidden ? "Insufficient permissions" : "Deal tidak ditemukan" },
        { status: forbidden ? 403 : 404 }
      );
    }

    const parsed = createPaymentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const row = await queryOne<{ id: string }>(
      `INSERT INTO crm.crm_sales_deal_payments
         (company_id, branch_id, deal_id, amount, method, paid_on, note,
          created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        deal.company_id,
        deal.branch_id,
        deal.id,
        Math.round(body.amount * 100) / 100,
        body.method,
        body.paid_on,
        body.note || null,
        user.id,
      ]
    );
    return createdResponse(row, "Pembayaran tercatat");
  } catch (err) {
    console.error("[sales-funnel] create payment error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencatat pembayaran" },
      { status: 500 }
    );
  }
}
