import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse, noContentResponse } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  QUOTATION_STATUSES,
  computeTotals,
  insertItems,
  quotationPayloadSchema,
  validateProducts,
} from "@/lib/sales-funnel/quotations";
import {
  requireSalesFunnelRole,
  type SalesFunnelUser,
} from "@/lib/sales-funnel/server";

const updateSchema = z.object({
  status: z.enum(QUOTATION_STATUSES).optional(),
  payload: quotationPayloadSchema.optional(),
});

type QuotationRow = {
  id: string;
  deal_id: string;
  status: string;
  stock_deducted_at: string | null;
};

/** Akses quotation mengikuti akses deal induknya. */
async function findAccessibleQuotation(
  id: string,
  user: SalesFunnelUser
): Promise<{ quotation: QuotationRow | null; forbidden: boolean }> {
  const quotation = await queryOne<QuotationRow>(
    `SELECT id, deal_id, status, stock_deducted_at
     FROM crm.crm_sales_quotations WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!quotation) return { quotation: null, forbidden: false };
  const { deal, forbidden } = await findAccessibleDeal(quotation.deal_id, user);
  if (forbidden || !deal) return { quotation: null, forbidden: true };
  return { quotation, forbidden: false };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { quotation, forbidden } = await findAccessibleQuotation(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!quotation) {
      return NextResponse.json(
        { success: false, error: "Quotation tidak ditemukan" },
        { status: 404 }
      );
    }

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const { status, payload } = parsed.data;
    if (!status && !payload) {
      return NextResponse.json(
        { success: false, error: "Tidak ada field yang diubah" },
        { status: 400 }
      );
    }
    // Quotation yang sudah direalisasikan stoknya (F3) dibekukan
    if (payload && quotation.stock_deducted_at) {
      return NextResponse.json(
        { success: false, error: "Quotation sudah direalisasi — isi tidak bisa diubah" },
        { status: 409 }
      );
    }

    const row = await withTransaction(async (client) => {
      if (payload) {
        const productError = await validateProducts(client, payload);
        if (productError) throw new Error(productError);
        const { subtotal, ppnNominal, total, lines } = computeTotals(payload);

        // Guard beku DI DALAM tulis (bukan hanya pre-check) — menutup race
        // dengan tombol Realisasi F3 yang mengisi stock_deducted_at
        const updated = await client.query(
          `UPDATE crm.crm_sales_quotations
           SET use_ppn = $1, ppn_persen = $2, subtotal = $3,
               ppn_nominal = $4, total = $5, notes = $6,
               valid_until = $7, updated_at = now()
           WHERE id = $8 AND stock_deducted_at IS NULL`,
          [
            payload.use_ppn,
            payload.ppn_persen,
            subtotal,
            ppnNominal,
            total,
            payload.notes || null,
            payload.valid_until || null,
            id,
          ]
        );
        if (updated.rowCount === 0) {
          throw new Error("Quotation sudah direalisasi — isi tidak bisa diubah");
        }
        await client.query(
          `DELETE FROM crm.crm_sales_quotation_items WHERE quotation_id = $1`,
          [id]
        );
        await insertItems(client, id, lines);

        // Estimasi deal mengikuti quotation terbaru selama deal berjalan
        await client.query(
          `UPDATE crm.crm_sales_deals
           SET value_estimate = $1, updated_at = now()
           WHERE id = $2 AND closed_at IS NULL`,
          [total, quotation.deal_id]
        );
      }
      if (status) {
        await client.query(
          `UPDATE crm.crm_sales_quotations
           SET status = $1, updated_at = now() WHERE id = $2`,
          [status, id]
        );
      }
      const result = await client.query(
        `SELECT id, quote_number, status, total FROM crm.crm_sales_quotations
         WHERE id = $1`,
        [id]
      );
      return result.rows[0];
    });

    return successResponse(row, "Quotation diperbarui");
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    const isKnown =
      raw.startsWith("Ada produk") || raw.startsWith("Quotation sudah direalisasi");
    const message = isKnown ? raw : "Gagal memperbarui quotation";
    console.error("[sales-funnel] update quotation error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: isKnown ? (raw.startsWith("Quotation") ? 409 : 400) : 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { quotation, forbidden } = await findAccessibleQuotation(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!quotation) {
      return NextResponse.json(
        { success: false, error: "Quotation tidak ditemukan" },
        { status: 404 }
      );
    }
    if (quotation.stock_deducted_at) {
      return NextResponse.json(
        { success: false, error: "Quotation sudah direalisasi — tidak bisa dihapus" },
        { status: 409 }
      );
    }

    // Guard beku di dalam tulis (anti-TOCTOU F3) + estimasi deal dihitung
    // ulang dari quotation tersisa terbaru agar kanban tidak menampilkan
    // angka penawaran yang sudah dihapus
    const deleted = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE crm.crm_sales_quotations
         SET deleted_at = now(), updated_at = now()
         WHERE id = $1 AND stock_deducted_at IS NULL RETURNING id, deal_id`,
        [id]
      );
      if (result.rowCount === 0) return null;

      await client.query(
        `UPDATE crm.crm_sales_deals d
         SET value_estimate = (
               SELECT q.total FROM crm.crm_sales_quotations q
               WHERE q.deal_id = d.id AND q.deleted_at IS NULL
               ORDER BY q.created_at DESC LIMIT 1
             ),
             updated_at = now()
         WHERE d.id = $1 AND d.closed_at IS NULL`,
        [quotation.deal_id]
      );
      return result.rows[0];
    });
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Quotation sudah direalisasi — tidak bisa dihapus" },
        { status: 409 }
      );
    }
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete quotation error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus quotation" },
      { status: 500 }
    );
  }
}
