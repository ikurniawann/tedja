import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import {
  INVOICE_VIEWER_ROLES,
  requireFinanceRole,
} from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import type { SalesFunnelUser } from "@/lib/sales-funnel/server";

// EPIC-025 (Opsi B) — siklus dokumen invoice diproses FINANCE:
// diajukan/draft → terkirim (terbit+kirim), atau batal (tolak).
// Pelunasan tidak diubah di sini (diturunkan dari pembayaran).

const updateSchema = z.object({
  status: z.enum(["terkirim", "batal"]),
});

type InvoiceRow = {
  id: string;
  deal_id: string;
  status: string;
  paid: string;
};

/** Akses invoice mengikuti akses deal induknya (pola findAccessibleQuotation). */
async function findAccessibleInvoice(
  id: string,
  user: SalesFunnelUser
): Promise<{ invoice: InvoiceRow | null; forbidden: boolean }> {
  const invoice = await queryOne<InvoiceRow>(
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Transisi status = wewenang finance (Opsi B)
  const { error, user } = await requireFinanceRole();
  if (error) return error;

  try {
    const { id } = await params;
    const { invoice, forbidden } = await findAccessibleInvoice(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!invoice) {
      return NextResponse.json(
        { success: false, error: "Invoice tidak ditemukan" },
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
    const { status } = parsed.data;

    // Invoice yang sudah menerima pembayaran tidak boleh dibatalkan —
    // hapus/koreksi catatan pembayarannya dulu
    if (status === "batal" && Number(invoice.paid) > 0) {
      return NextResponse.json(
        { success: false, error: "Invoice sudah menerima pembayaran — tidak bisa dibatalkan" },
        { status: 409 }
      );
    }

    const row = await queryOne<{ id: string; invoice_number: string; status: string }>(
      // status dikirim DUA kali ($1 & $2) — satu parameter untuk dua
      // konteks (kolom varchar + perbandingan text) membuat Postgres
      // gagal mendeduksi tipe (42P08)
      `UPDATE crm.crm_sales_invoices
       SET status = $1,
           sent_at = CASE
             WHEN $2::text = 'terkirim' AND sent_at IS NULL THEN now()
             ELSE sent_at
           END,
           updated_at = now()
       WHERE id = $3
       RETURNING id, invoice_number, status`,
      [status, status, id]
    );

    let accountingNote: string | null = null;
    if (status === "terkirim" && row) {
      try {
        const { createArInvoiceFromSalesInvoice } = await import(
          "@/lib/accounting/ar-store"
        );
        const ar = await createArInvoiceFromSalesInvoice({
          salesInvoiceId: id,
          userId: user.id,
        });
        accountingNote = ar.note
          ? `AR ${ar.invoice.invoice_no} (${ar.note})`
          : `AR ${ar.invoice.invoice_no}`;
      } catch (arErr) {
        console.error("[sales-funnel] create AR invoice:", arErr);
        accountingNote =
          arErr instanceof Error
            ? `AR gagal: ${arErr.message}`
            : "AR gagal dibuat";
      }
    }

    return successResponse(
      row,
      accountingNote
        ? `Invoice diperbarui (${accountingNote})`
        : "Invoice diperbarui"
    );
  } catch (err) {
    console.error("[sales-funnel] update invoice error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui invoice" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
  if (error) return error;

  try {
    const { id } = await params;
    const { invoice, forbidden } = await findAccessibleInvoice(id, user);
    if (forbidden) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }
    if (!invoice) {
      return NextResponse.json(
        { success: false, error: "Invoice tidak ditemukan" },
        { status: 404 }
      );
    }
    // Sales hanya boleh menarik PENGAJUANNYA yang belum diproses finance
    if (user.role === "sales" && invoice.status !== "diajukan") {
      return NextResponse.json(
        { success: false, error: "Invoice sudah diproses Finance — hubungi finance untuk pembatalan" },
        { status: 403 }
      );
    }
    if (Number(invoice.paid) > 0) {
      return NextResponse.json(
        { success: false, error: "Invoice sudah menerima pembayaran — tidak bisa dihapus" },
        { status: 409 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_invoices
       SET deleted_at = now(), deleted_by = $2, updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [id, user.id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete invoice error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus invoice" },
      { status: 500 }
    );
  }
}
