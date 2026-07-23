import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requireFinanceRole, type FinanceUser } from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { isValidCalendarDate } from "@/lib/sales-funnel/server";

// EPIC-025 — detail invoice utk Finance (acuan quotation/termin jelas) +
// revisi field (label/nominal/jatuh tempo/catatan). Revisi ditolak bila
// invoice sudah batal atau sudah menerima pembayaran (nominal jadi tidak
// sinkron dengan uang yang sudah masuk).

const reviseSchema = z.object({
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

type InvoiceAccessRow = { id: string; deal_id: string; status: string; paid: string };

/** Akses invoice mengikuti akses deal induknya (pola findAccessibleQuotation). */
async function findAccessibleInvoice(
  id: string,
  user: FinanceUser
): Promise<{ invoice: InvoiceAccessRow | null; forbidden: boolean }> {
  const invoice = await queryOne<InvoiceAccessRow>(
    `SELECT i.id, i.deal_id, i.status,
            COALESCE(
              (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
               WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
              0
            ) AS paid
     FROM crm.crm_sales_invoices i
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
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

    const row = await queryOne<{
      id: string;
      invoice_number: string;
      label: string;
      amount: string;
      due_date: string | null;
      status: string;
      sent_at: string | null;
      note: string | null;
      created_at: string;
      created_by_name: string | null;
      deal_id: string;
      deal_title: string;
      event_type: string;
      event_date: string | null;
      org_name: string;
      pic_name: string;
      pic_phone: string;
      pic_title: string | null;
      quotation_id: string | null;
      quote_number: string | null;
      quotation_status: string | null;
      quotation_total: string | null;
      quotation_use_ppn: boolean | null;
      quotation_ppn_persen: string | null;
      term_id: string | null;
      term_label: string | null;
      term_percent: string | null;
      term_due_date: string | null;
      faktur_pajak_url: string | null;
      paid: string;
    }>(
      `SELECT i.id, i.invoice_number, i.label, i.amount,
              i.due_date::text AS due_date, i.status, i.sent_at, i.note,
              i.faktur_pajak_url,
              i.created_at, u.full_name AS created_by_name,
              i.deal_id, d.title AS deal_title, d.event_type,
              d.event_date::text AS event_date,
              l.org_name, l.pic_name, l.pic_phone, l.pic_title,
              q.id AS quotation_id, q.quote_number, q.status AS quotation_status,
              q.total AS quotation_total, q.use_ppn AS quotation_use_ppn,
              q.ppn_persen AS quotation_ppn_persen,
              t.id AS term_id, t.label AS term_label, t.percent AS term_percent,
              t.due_date::text AS term_due_date,
              COALESCE(
                (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
                 WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
                0
              ) AS paid
       FROM crm.crm_sales_invoices i
       JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
       LEFT JOIN crm.crm_sales_quotation_terms t ON t.id = i.term_id
       LEFT JOIN configuration.users u ON u.id = i.created_by
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [id]
    );
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Invoice tidak ditemukan" },
        { status: 404 }
      );
    }

    const amount = Number(row.amount);
    const paid = Number(row.paid);

    return successResponse({
      id: row.id,
      invoice_number: row.invoice_number,
      label: row.label,
      amount,
      due_date: row.due_date,
      status: row.status,
      sent_at: row.sent_at,
      note: row.note,
      created_at: row.created_at,
      created_by_name: row.created_by_name,
      deal_id: row.deal_id,
      deal_title: row.deal_title,
      event_type: row.event_type,
      event_date: row.event_date,
      org_name: row.org_name,
      pic_name: row.pic_name,
      pic_phone: row.pic_phone,
      pic_title: row.pic_title,
      // Path storage tak diekspos — unduh selalu lewat route ber-auth
      has_faktur_pajak: row.faktur_pajak_url !== null,
      quotation: row.quotation_id
        ? {
            id: row.quotation_id,
            quote_number: row.quote_number,
            status: row.quotation_status,
            total: Number(row.quotation_total),
            use_ppn: row.quotation_use_ppn,
            ppn_persen: Number(row.quotation_ppn_persen),
          }
        : null,
      term: row.term_id
        ? {
            id: row.term_id,
            label: row.term_label,
            percent: Number(row.term_percent),
            due_date: row.term_due_date,
          }
        : null,
      paid,
      payment_status:
        amount > 0 && paid >= amount ? "lunas" : paid > 0 ? "sebagian" : "belum",
      outstanding: Math.max(0, Math.round((amount - paid) * 100) / 100),
    });
  } catch (err) {
    console.error("[finance] invoice detail error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat detail invoice" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
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
    if (invoice.status === "batal") {
      return NextResponse.json(
        { success: false, error: "Invoice sudah dibatalkan — tidak bisa direvisi" },
        { status: 409 }
      );
    }
    if (Number(invoice.paid) > 0) {
      return NextResponse.json(
        { success: false, error: "Invoice sudah menerima pembayaran — tidak bisa direvisi" },
        { status: 409 }
      );
    }

    const parsed = reviseSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const row = await queryOne<{ id: string; invoice_number: string }>(
      `UPDATE crm.crm_sales_invoices
       SET label = $1, amount = $2, due_date = $3, note = $4, updated_at = now()
       WHERE id = $5 AND deleted_at IS NULL AND status <> 'batal'
       RETURNING id, invoice_number`,
      [
        body.label,
        Math.round(body.amount * 100) / 100,
        body.due_date || null,
        body.note || null,
        id,
      ]
    );
    if (!row) {
      return NextResponse.json(
        { success: false, error: "Invoice sudah dibatalkan — tidak bisa direvisi" },
        { status: 409 }
      );
    }
    return successResponse(row, `Invoice ${row.invoice_number} direvisi`);
  } catch (err) {
    console.error("[finance] revise invoice error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal merevisi invoice" },
      { status: 500 }
    );
  }
}
