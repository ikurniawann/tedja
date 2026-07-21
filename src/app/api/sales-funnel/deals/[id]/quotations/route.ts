import { NextRequest, NextResponse } from "next/server";
import { createdResponse, successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  computeTotals,
  insertItems,
  quotationPayloadSchema,
  validateProducts,
} from "@/lib/sales-funnel/quotations";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/** Daftar quotation sebuah deal + baris itemnya (EPIC-022 Fase F1). */
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

    const rows = await query(
      `SELECT q.id, q.quote_number, q.status, q.use_ppn, q.ppn_persen,
              q.subtotal, q.ppn_nominal, q.total, q.notes, q.valid_until,
              q.stock_deducted_at, q.created_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'id', i.id, 'item_type', i.item_type,
                   'product_id', i.product_id, 'description', i.description,
                   'qty', i.qty, 'unit_price', i.unit_price,
                   'line_total', i.line_total
                 ) ORDER BY i.sort_order)
                 FROM crm.crm_sales_quotation_items i
                 WHERE i.quotation_id = q.id),
                '[]'::json
              ) AS items
       FROM crm.crm_sales_quotations q
       WHERE q.deal_id = $1 AND q.deleted_at IS NULL
       ORDER BY q.created_at DESC
       LIMIT 20`,
      [id]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[sales-funnel] list quotations error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat quotation" },
      { status: 500 }
    );
  }
}

/** Buat quotation baru — total dihitung server, item dalam satu transaksi. */
export async function POST(
  request: NextRequest,
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

    const parsed = quotationPayloadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const payload = parsed.data;
    const { subtotal, ppnNominal, total, lines } = computeTotals(payload);

    const row = await withTransaction(async (client) => {
      const productError = await validateProducts(client, payload);
      if (productError) throw new Error(productError);

      const inserted = await client.query<{
        id: string;
        quote_number: string;
        total: string;
      }>(
        `INSERT INTO crm.crm_sales_quotations
           (company_id, branch_id, deal_id, quote_number, use_ppn,
            ppn_persen, subtotal, ppn_nominal, total, notes, valid_until,
            created_by)
         VALUES ($1, $2, $3,
                 'QT-' || to_char(now(), 'YYMM') || '-' ||
                   lpad(nextval('crm.crm_sales_quotation_number_seq')::text, 4, '0'),
                 $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, quote_number, total`,
        [
          deal.company_id,
          deal.branch_id,
          deal.id,
          payload.use_ppn,
          payload.ppn_persen,
          subtotal,
          ppnNominal,
          total,
          payload.notes || null,
          payload.valid_until || null,
          user.id,
        ]
      );
      const quotation = inserted.rows[0];
      await insertItems(client, quotation.id, lines);

      // Total penawaran = estimasi nilai deal berjalan
      await client.query(
        `UPDATE crm.crm_sales_deals
         SET value_estimate = $1, updated_at = now()
         WHERE id = $2 AND closed_at IS NULL`,
        [total, deal.id]
      );
      return quotation;
    });

    return createdResponse(row, `Quotation ${row.quote_number} dibuat`);
  } catch (err) {
    const message =
      err instanceof Error && err.message.startsWith("Ada produk")
        ? err.message
        : "Gagal membuat quotation";
    console.error("[sales-funnel] create quotation error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: message === "Gagal membuat quotation" ? 500 : 400 }
    );
  }
}
