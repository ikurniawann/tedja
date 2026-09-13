import { NextRequest, NextResponse } from "next/server";
import { createdResponse } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";
import { syncQuotationApproval } from "@/lib/crm/approvals-server";
import { emitCrmEvent } from "@/lib/crm/events";

/**
 * EPIC-050 T-3.4 — buat versi baru quotation: salin header/item/termin sebagai
 * draft v+1 (nomor baru), versi lama ditandai `superseded` (tetap tersimpan
 * sebagai riwayat). Approval diskon dihitung ulang untuk versi baru.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;
  const { id } = await params;
  const src = await queryOne<{ id: string; deal_id: string; status: string; version: number; parent_quotation_id: string | null; stock_deducted_at: string | null }>(
    `SELECT id, deal_id, status, version, parent_quotation_id, stock_deducted_at
     FROM crm.crm_sales_quotations WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!src) return NextResponse.json({ success: false, error: "Quotation tidak ditemukan" }, { status: 404 });
  const { deal, forbidden } = await findAccessibleDeal(src.deal_id, user);
  if (forbidden || !deal) {
    return NextResponse.json({ success: false, error: forbidden ? "Insufficient permissions" : "Deal tidak ditemukan" }, { status: forbidden ? 403 : 404 });
  }
  if (src.status === "superseded") {
    return NextResponse.json({ success: false, error: "Versi ini sudah digantikan — buat revisi dari versi terbaru" }, { status: 409 });
  }
  const rootId = src.parent_quotation_id ?? src.id;
  const row = await withTransaction(async (client) => {
    const latest = await client.query<{ v: number }>(
      `SELECT COALESCE(max(version), 1) AS v FROM crm.crm_sales_quotations WHERE (id = $1 OR parent_quotation_id = $1) AND deleted_at IS NULL`,
      [rootId]
    );
    const nextVersion = Number(latest.rows[0]?.v ?? 1) + 1;
    const inserted = await client.query<{ id: string; quote_number: string; version: number }>(
      `INSERT INTO crm.crm_sales_quotations
         (company_id, branch_id, deal_id, quote_number, use_ppn, ppn_persen, subtotal, ppn_nominal, total,
          notes, valid_until, created_by, discount_percent, discount_nominal, version, parent_quotation_id, status)
       SELECT company_id, branch_id, deal_id,
              'QT-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('crm.crm_sales_quotation_number_seq')::text, 4, '0'),
              use_ppn, ppn_persen, subtotal, ppn_nominal, total, notes, valid_until, $2, discount_percent, discount_nominal,
              $3, $4, 'draft'
       FROM crm.crm_sales_quotations WHERE id = $1
       RETURNING id, quote_number, version`,
      [id, user.id, nextVersion, rootId]
    );
    const q = inserted.rows[0];
    await client.query(
      `INSERT INTO crm.crm_sales_quotation_items (quotation_id, item_type, product_id, description, qty, unit_price, line_total, sort_order)
       SELECT $2, item_type, product_id, description, qty, unit_price, line_total, sort_order
       FROM crm.crm_sales_quotation_items WHERE quotation_id = $1`,
      [id, q.id]
    );
    await client.query(
      `INSERT INTO crm.crm_sales_quotation_terms (quotation_id, label, percent, due_date, sort_order)
       SELECT $2, label, percent, due_date, sort_order FROM crm.crm_sales_quotation_terms WHERE quotation_id = $1`,
      [id, q.id]
    );
    // versi lama → superseded (kecuali sudah direalisasi: biarkan statusnya)
    if (!src.stock_deducted_at) {
      await client.query(`UPDATE crm.crm_sales_quotations SET status = 'superseded', superseded_at = now(), updated_at = now() WHERE id = $1`, [id]);
    }
    return q;
  });
  await syncQuotationApproval(row.id, user.id).catch((e) => console.error("[crm-approval] sync gagal:", e));
  await emitCrmEvent({ event_type: "quotation.created", subject_type: "quotation", subject_id: row.id, company_id: deal.company_id, branch_id: deal.branch_id, actor_user_id: user.id, payload: { revised_from: id, version: row.version } });
  return createdResponse(row, `Revisi v${row.version} dibuat`);
}
