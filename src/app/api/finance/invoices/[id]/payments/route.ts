import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireFinanceRole, type FinanceUser } from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { isValidCalendarDate } from "@/lib/sales-funnel/server";

// EPIC-025 — pembayaran per INVOICE, dicatat oleh finance. Baris tetap
// masuk crm_sales_deal_payments (satu sumber data dengan progress pipeline).

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

type InvoiceRow = {
  id: string;
  deal_id: string;
  status: string;
  company_id: string;
  branch_id: string;
};

/** Akses invoice mengikuti akses deal induknya. */
async function findAccessibleInvoice(
  id: string,
  user: FinanceUser
): Promise<{ invoice: InvoiceRow | null; forbidden: boolean }> {
  const invoice = await queryOne<InvoiceRow>(
    `SELECT id, deal_id, status, company_id, branch_id
     FROM crm.crm_sales_invoices
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!invoice) return { invoice: null, forbidden: false };
  const { deal, forbidden } = await findAccessibleDeal(invoice.deal_id, user);
  if (forbidden || !deal) return { invoice: null, forbidden: true };
  return { invoice, forbidden: false };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireFinanceRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { invoice, forbidden } = await findAccessibleInvoice(id, user);
    if (forbidden || !invoice) {
      return NextResponse.json(
        { success: false, error: forbidden ? "Insufficient permissions" : "Invoice tidak ditemukan" },
        { status: forbidden ? 403 : 404 }
      );
    }

    const rows = await query(
      `SELECT p.id, p.amount, p.method, p.paid_on::text AS paid_on, p.note,
              u.full_name AS created_by_name, p.created_at
       FROM crm.crm_sales_deal_payments p
       LEFT JOIN configuration.users u ON u.id = p.created_by
       WHERE p.invoice_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.paid_on DESC, p.created_at DESC`,
      [id]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[finance] list invoice payments error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat pembayaran invoice" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireFinanceRole();
  if (error) return error;

  const rate = checkRateLimit(`finance-payment:${user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pencatatan — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id } = await params;
    const { invoice, forbidden } = await findAccessibleInvoice(id, user);
    if (forbidden || !invoice) {
      return NextResponse.json(
        { success: false, error: forbidden ? "Insufficient permissions" : "Invoice tidak ditemukan" },
        { status: forbidden ? 403 : 404 }
      );
    }
    if (invoice.status === "batal") {
      return NextResponse.json(
        { success: false, error: "Invoice sudah dibatalkan" },
        { status: 409 }
      );
    }
    if (invoice.status === "diajukan") {
      return NextResponse.json(
        { success: false, error: "Terbitkan invoice dulu sebelum mencatat pembayaran" },
        { status: 409 }
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
         (company_id, branch_id, deal_id, invoice_id, amount, method,
          paid_on, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        invoice.company_id,
        invoice.branch_id,
        invoice.deal_id,
        invoice.id,
        Math.round(body.amount * 100) / 100,
        body.method,
        body.paid_on,
        body.note || null,
        user.id,
      ]
    );
    return createdResponse(row, "Pembayaran tercatat");
  } catch (err) {
    console.error("[finance] create invoice payment error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencatat pembayaran" },
      { status: 500 }
    );
  }
}
