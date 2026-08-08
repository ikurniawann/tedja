import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  INVOICE_VIEWER_ROLES,
  requireFinanceRole,
} from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { allocateTermAmounts } from "@/lib/sales-funnel/quotations";
import { isValidCalendarDate } from "@/lib/sales-funnel/server";

// EPIC-025 (Opsi B): POST di sini = PENGAJUAN invoice (status 'diajukan')
// dari termin quotation acuan — sales maupun super_admin sama-sama
// mengajukan; penerbitan/kirim/batal dan pembayaran diproses finance di
// /dashboard/accounting/receivable/invoices-b2b. Status pelunasan diturunkan dari pembayaran.

const createInvoiceSchema = z.object({
  term_id: z.string().uuid().optional().nullable(),
  label: z.string().trim().min(1).max(150),
  amount: z.number().positive().max(999_999_999_999),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidCalendarDate, { message: "Tanggal tidak valid" })
    .optional()
    .nullable()
    .or(z.literal("")),
  note: z.string().trim().max(300).optional().nullable(),
});

type PaymentStatus = "belum" | "sebagian" | "lunas";

function derivePaymentStatus(paid: number, amount: number): PaymentStatus {
  if (amount > 0 && paid >= amount) return "lunas";
  if (paid > 0) return "sebagian";
  return "belum";
}

async function loadInvoiceData(dealId: string) {
  const [invoices, refQuotation] = await Promise.all([
    query<{
      id: string;
      invoice_number: string;
      label: string;
      amount: string;
      due_date: string | null;
      status: string;
      sent_at: string | null;
      note: string | null;
      quotation_id: string | null;
      term_id: string | null;
      quote_number: string | null;
      paid: string;
      created_at: string;
    }>(
      `SELECT i.id, i.invoice_number, i.label, i.amount,
              i.due_date::text AS due_date, i.status, i.sent_at, i.note,
              i.quotation_id, i.term_id, q.quote_number,
              COALESCE(
                (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
                 WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
                0
              ) AS paid,
              i.created_at
       FROM crm.crm_sales_invoices i
       LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
       WHERE i.deal_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 50`,
      [dealId]
    ),
    // Acuan termin: quotation diterima terbaru → quotation terbaru (pola
    // yang sama dengan loadPaymentSummary Fase G)
    queryOne<{
      id: string;
      quote_number: string;
      status: string;
      total: string;
      use_ppn: boolean;
      ppn_persen: string;
    }>(
      `SELECT id, quote_number, status, total, use_ppn, ppn_persen
       FROM crm.crm_sales_quotations
       WHERE deal_id = $1 AND deleted_at IS NULL
       ORDER BY (status = 'diterima') DESC, created_at DESC
       LIMIT 1`,
      [dealId]
    ),
  ]);

  const terms = refQuotation
    ? await query<{
        id: string;
        label: string;
        percent: string;
        due_date: string | null;
      }>(
        `SELECT id, label, percent, due_date::text AS due_date
         FROM crm.crm_sales_quotation_terms
         WHERE quotation_id = $1
         ORDER BY sort_order`,
        [refQuotation.id]
      )
    : [];

  const amounts = allocateTermAmounts(
    refQuotation ? Number(refQuotation.total) : 0,
    terms.map((t) => Number(t.percent))
  );
  const invoicedTermIds = new Set(
    invoices
      .filter((inv) => inv.term_id && inv.status !== "batal")
      .map((inv) => inv.term_id as string)
  );

  return {
    invoices: invoices.map((inv) => {
      const amount = Number(inv.amount);
      const paid = Number(inv.paid);
      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        label: inv.label,
        amount,
        due_date: inv.due_date,
        status: inv.status,
        sent_at: inv.sent_at,
        note: inv.note,
        quotation_id: inv.quotation_id,
        term_id: inv.term_id,
        quote_number: inv.quote_number,
        paid,
        payment_status: derivePaymentStatus(paid, amount),
        created_at: inv.created_at,
      };
    }),
    reference: refQuotation
      ? {
          quotation_id: refQuotation.id,
          quote_number: refQuotation.quote_number,
          is_accepted: refQuotation.status === "diterima",
          total: Number(refQuotation.total),
          // PPN invoice mengikuti setelan quotation acuan
          use_ppn: refQuotation.use_ppn,
          ppn_persen: Number(refQuotation.ppn_persen),
        }
      : null,
    available_terms: terms.map((term, index) => ({
      term_id: term.id,
      label: term.label,
      percent: Number(term.percent),
      amount: amounts[index],
      due_date: term.due_date,
      invoiced: invoicedTermIds.has(term.id),
    })),
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
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
    return successResponse(await loadInvoiceData(id));
  } catch (err) {
    console.error("[sales-funnel] list invoices error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat invoice" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`sales-invoice:${user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak pembuatan invoice — coba lagi sebentar" },
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

    const parsed = createInvoiceSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // Termin harus milik quotation deal ini; satu termin satu invoice aktif
    let quotationId: string | null = null;
    if (body.term_id) {
      const term = await queryOne<{ quotation_id: string }>(
        `SELECT t.quotation_id
         FROM crm.crm_sales_quotation_terms t
         JOIN crm.crm_sales_quotations q ON q.id = t.quotation_id
         WHERE t.id = $1 AND q.deal_id = $2 AND q.deleted_at IS NULL`,
        [body.term_id, id]
      );
      if (!term) {
        return NextResponse.json(
          { success: false, error: "Termin tidak ditemukan pada quotation deal ini" },
          { status: 400 }
        );
      }
      quotationId = term.quotation_id;
    }

    const row = await queryOne<{ id: string; invoice_number: string }>(
      `INSERT INTO crm.crm_sales_invoices
         (company_id, branch_id, deal_id, quotation_id, term_id,
          invoice_number, label, amount, due_date, note, created_by, status)
       VALUES ($1, $2, $3, $4, $5,
               'INV-' || to_char(now(), 'YYMM') || '-' ||
                 lpad(nextval('crm.crm_sales_invoice_number_seq')::text, 4, '0'),
               $6, $7, $8, $9, $10, 'diajukan')
       RETURNING id, invoice_number`,
      [
        deal.company_id,
        deal.branch_id,
        deal.id,
        quotationId,
        body.term_id || null,
        body.label,
        Math.round(body.amount * 100) / 100,
        body.due_date || null,
        body.note || null,
        user.id,
      ]
    );
    return createdResponse(row, `Pengajuan invoice ${row?.invoice_number} terkirim ke Finance`);
  } catch (err) {
    // Index unik uq_crm_sales_invoices_term_active — termin sudah ber-invoice
    if (
      err instanceof Error &&
      err.message.includes("uq_crm_sales_invoices_term_active")
    ) {
      return NextResponse.json(
        { success: false, error: "Termin ini sudah memiliki invoice aktif" },
        { status: 409 }
      );
    }
    console.error("[sales-funnel] create invoice error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat invoice" },
      { status: 500 }
    );
  }
}
