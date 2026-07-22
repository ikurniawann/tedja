import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  buildInvoicePdf,
  invoiceFileName,
} from "@/lib/sales-funnel/invoice-pdf";
import {
  INVOICE_VIEWER_ROLES,
  requireFinanceRole,
} from "@/lib/finance/server";

const EVENT_LABELS: Record<string, string> = {
  gathering: "Gathering",
  "field-trip": "Field Trip",
  "ulang-tahun": "Ulang Tahun",
  "buyout-venue": "Buyout Venue",
  lainnya: "Acara",
};

/** Unduh PDF invoice — akses via deal induk (pola PDF quotation). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;

  try {
    const { id } = await params;
    // Cek akses dgn fetch minimal DULU — jangan materialisasi PII tenant
    // lain ke memori sebelum otorisasi lolos
    const ref = await queryOne<{ id: string; deal_id: string }>(
      `SELECT id, deal_id FROM crm.crm_sales_invoices
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!ref) {
      return NextResponse.json(
        { success: false, error: "Invoice tidak ditemukan" },
        { status: 404 }
      );
    }
    const { deal, forbidden } = await findAccessibleDeal(ref.deal_id, user);
    if (forbidden || !deal) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const invoice = await queryOne<{
      invoice_number: string;
      label: string;
      amount: string;
      due_date: string | null;
      status: string;
      note: string | null;
      created_at: string;
      paid: string;
      quote_number: string | null;
      use_ppn: boolean | null;
      ppn_persen: string | null;
      term_percent: string | null;
      deal_title: string;
      event_type: string;
      event_date: string | null;
      org_name: string;
      pic_name: string;
      pic_title: string | null;
      owner_name: string | null;
      company_name: string | null;
      branch_name: string | null;
    }>(
      `SELECT i.invoice_number, i.label, i.amount,
              i.due_date::text AS due_date, i.status, i.note, i.created_at,
              COALESCE(
                (SELECT SUM(p.amount) FROM crm.crm_sales_deal_payments p
                 WHERE p.invoice_id = i.id AND p.deleted_at IS NULL),
                0
              ) AS paid,
              q.quote_number, q.use_ppn, q.ppn_persen,
              t.percent AS term_percent,
              d.title AS deal_title, d.event_type, d.event_date,
              l.org_name, l.pic_name, l.pic_title,
              u.full_name AS owner_name,
              c.name AS company_name, b.name AS branch_name
       FROM crm.crm_sales_invoices i
       JOIN crm.crm_sales_deals d ON d.id = i.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       LEFT JOIN crm.crm_sales_quotations q ON q.id = i.quotation_id
       LEFT JOIN crm.crm_sales_quotation_terms t ON t.id = i.term_id
       LEFT JOIN configuration.users u ON u.id = d.owner_user_id
       LEFT JOIN configuration.companies c ON c.id = i.company_id
       LEFT JOIN configuration.branches b ON b.id = i.branch_id
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [id]
    );
    if (!invoice) {
      return NextResponse.json(
        { success: false, error: "Invoice tidak ditemukan" },
        { status: 404 }
      );
    }

    const pdf = await buildInvoicePdf({
      invoice_number: invoice.invoice_number,
      label: invoice.label,
      amount: Number(invoice.amount),
      paid: Number(invoice.paid),
      due_date: invoice.due_date,
      status: invoice.status,
      created_at: invoice.created_at,
      company_name: invoice.company_name,
      branch_name: invoice.branch_name,
      org_name: invoice.org_name,
      pic_name: invoice.pic_name,
      pic_title: invoice.pic_title,
      deal_title: invoice.deal_title,
      event_type_label: EVENT_LABELS[invoice.event_type] ?? "Acara",
      event_date: invoice.event_date,
      quote_number: invoice.quote_number,
      term_percent:
        invoice.term_percent !== null ? Number(invoice.term_percent) : null,
      // PPN mengikuti setelan quotation asal invoice
      use_ppn: invoice.use_ppn ?? false,
      ppn_persen: Number(invoice.ppn_persen ?? 0),
      note: invoice.note,
      owner_name: invoice.owner_name,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceFileName(
          invoice.invoice_number,
          invoice.org_name
        )}"`,
      },
    });
  } catch (err) {
    console.error("[sales-funnel] invoice pdf error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat PDF invoice" },
      { status: 500 }
    );
  }
}
