import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  buildQuotationPdf,
  quotationFileName,
  type QuotationPdfItem,
} from "@/lib/sales-funnel/quotation-pdf";
import { allocateTermAmounts } from "@/lib/sales-funnel/quotations";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

const EVENT_LABELS: Record<string, string> = {
  gathering: "Gathering",
  "field-trip": "Field Trip",
  "ulang-tahun": "Ulang Tahun",
  "buyout-venue": "Buyout Venue",
  lainnya: "Acara",
};

/** Unduh PDF quotation (EPIC-022 Fase F2) — akses via deal induk. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    // Cek akses dgn fetch minimal DULU — jangan materialisasi PII tenant
    // lain ke memori sebelum otorisasi lolos (pola findAccessibleQuotation)
    const ref = await queryOne<{ id: string; deal_id: string }>(
      `SELECT id, deal_id FROM crm.crm_sales_quotations
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!ref) {
      return NextResponse.json(
        { success: false, error: "Quotation tidak ditemukan" },
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

    const quotation = await queryOne<{
      id: string;
      deal_id: string;
      quote_number: string;
      status: string;
      use_ppn: boolean;
      ppn_persen: string;
      subtotal: string;
      discount_percent: string;
      discount_nominal: string;
      ppn_nominal: string;
      total: string;
      notes: string | null;
      valid_until: string | null;
      created_at: string;
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
      `SELECT q.id, q.deal_id, q.quote_number, q.status, q.use_ppn,
              q.ppn_persen, q.subtotal, q.ppn_nominal, q.total, q.notes,
              q.discount_percent, q.discount_nominal,
              q.valid_until, q.created_at,
              d.title AS deal_title, d.event_type, d.event_date,
              l.org_name, l.pic_name, l.pic_title,
              u.full_name AS owner_name,
              c.name AS company_name, b.name AS branch_name
       FROM crm.crm_sales_quotations q
       JOIN crm.crm_sales_deals d ON d.id = q.deal_id
       JOIN crm.crm_sales_leads l ON l.id = d.lead_id
       LEFT JOIN configuration.users u ON u.id = d.owner_user_id
       LEFT JOIN configuration.companies c ON c.id = q.company_id
       LEFT JOIN configuration.branches b ON b.id = q.branch_id
       WHERE q.id = $1 AND q.deleted_at IS NULL`,
      [id]
    );
    if (!quotation) {
      return NextResponse.json(
        { success: false, error: "Quotation tidak ditemukan" },
        { status: 404 }
      );
    }

    const [items, terms] = await Promise.all([
      query<{
        description: string;
        item_type: string;
        qty: string;
        unit_price: string;
        line_total: string;
      }>(
        `SELECT description, item_type, qty, unit_price, line_total
         FROM crm.crm_sales_quotation_items
         WHERE quotation_id = $1
         ORDER BY sort_order ASC`,
        [id]
      ),
      query<{ label: string; percent: string; due_date: string | null }>(
        `SELECT label, percent, due_date::text AS due_date
         FROM crm.crm_sales_quotation_terms
         WHERE quotation_id = $1
         ORDER BY sort_order ASC`,
        [id]
      ),
    ]);
    const termAmounts = allocateTermAmounts(
      Number(quotation.total),
      terms.map((t) => Number(t.percent))
    );

    const pdf = await buildQuotationPdf({
      quote_number: quotation.quote_number,
      created_at: quotation.created_at,
      valid_until: quotation.valid_until,
      status: quotation.status,
      company_name: quotation.company_name,
      branch_name: quotation.branch_name,
      org_name: quotation.org_name,
      pic_name: quotation.pic_name,
      pic_title: quotation.pic_title,
      deal_title: quotation.deal_title,
      event_type_label: EVENT_LABELS[quotation.event_type] ?? "Acara",
      event_date: quotation.event_date,
      use_ppn: quotation.use_ppn,
      ppn_persen: Number(quotation.ppn_persen),
      subtotal: Number(quotation.subtotal),
      discount_percent: Number(quotation.discount_percent ?? 0),
      discount_nominal: Number(quotation.discount_nominal ?? 0),
      ppn_nominal: Number(quotation.ppn_nominal),
      total: Number(quotation.total),
      notes: quotation.notes,
      owner_name: quotation.owner_name,
      items: items.map(
        (item): QuotationPdfItem => ({
          description: item.description,
          item_type: item.item_type,
          qty: Number(item.qty),
          unit_price: Number(item.unit_price),
          line_total: Number(item.line_total),
        })
      ),
      terms: terms.map((term, i) => ({
        label: term.label,
        percent: Number(term.percent),
        amount: termAmounts[i],
        due_date: term.due_date,
      })),
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quotationFileName(
          quotation.quote_number,
          quotation.org_name
        )}"`,
      },
    });
  } catch (err) {
    console.error("[sales-funnel] quotation pdf error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat PDF quotation" },
      { status: 500 }
    );
  }
}
