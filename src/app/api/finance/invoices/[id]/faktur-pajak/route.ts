import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import {
  INVOICE_VIEWER_ROLES,
  requireFinanceRole,
  type FinanceUser,
} from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import {
  deletePrivateFile,
  readPrivateFile,
  savePrivateDocument,
} from "@/lib/storage-private";

/**
 * Lampiran Faktur Pajak per invoice (EPIC-025) — dokumen pajak resmi
 * terpisah dari PDF invoice internal. Satu lampiran per invoice (pola
 * signed_document_url kontrak EPIC-006): re-upload menimpa file lama.
 *   POST   unggah (PDF/JPG/PNG/WebP, maks 10 MB) — finance-only
 *   GET    sajikan file (inline, ber-auth) — sales boleh lihat, tak bisa ubah
 *   DELETE hapus lampiran — finance-only
 */

const MAX_BYTES = 10 * 1024 * 1024;

type InvoiceRow = {
  id: string;
  deal_id: string;
  invoice_number: string;
  faktur_pajak_url: string | null;
};

async function findAccessibleInvoice(
  id: string,
  user: FinanceUser
): Promise<{ invoice: InvoiceRow | null; forbidden: boolean }> {
  const invoice = await queryOne<InvoiceRow>(
    `SELECT id, deal_id, invoice_number, faktur_pajak_url
     FROM crm.crm_sales_invoices WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!invoice) return { invoice: null, forbidden: false };
  const { deal, forbidden } = await findAccessibleDeal(invoice.deal_id, user);
  if (forbidden || !deal) return { invoice: null, forbidden: true };
  return { invoice, forbidden: false };
}

export async function POST(
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

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: "Form data tidak valid" },
        { status: 400 }
      );
    }
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "File tidak ditemukan" },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "Ukuran dokumen maksimal 10 MB" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await savePrivateDocument(buffer, `invoice-faktur-pajak/${invoice.deal_id}`);
    if (!saved.path) {
      return NextResponse.json(
        { success: false, error: saved.error ?? "Gagal menyimpan dokumen — pastikan PDF/JPG/PNG/WebP" },
        { status: 400 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_invoices
       SET faktur_pajak_url = $2, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [invoice.id, saved.path]
    );
    if (invoice.faktur_pajak_url) {
      await deletePrivateFile(invoice.faktur_pajak_url);
    }

    return NextResponse.json({
      success: true,
      message: `Faktur pajak ${invoice.invoice_number} tersimpan`,
    });
  } catch (err) {
    console.error("[finance] upload faktur pajak error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mengunggah faktur pajak" },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, user } = await requireFinanceRole(INVOICE_VIEWER_ROLES);
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
    if (!invoice.faktur_pajak_url) {
      return NextResponse.json(
        { success: false, error: "Invoice ini belum punya lampiran faktur pajak" },
        { status: 404 }
      );
    }

    const { data, mime } = await readPrivateFile(invoice.faktur_pajak_url);
    if (!data) {
      return NextResponse.json({ success: false, error: "File tidak ditemukan" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mime ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="faktur-pajak-${invoice.invoice_number.replace(/[^a-zA-Z0-9.-]/g, "_")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[finance] get faktur pajak error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat faktur pajak" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
    if (!invoice.faktur_pajak_url) {
      return NextResponse.json(
        { success: false, error: "Invoice ini belum punya lampiran faktur pajak" },
        { status: 409 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_invoices
       SET faktur_pajak_url = NULL, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [invoice.id]
    );
    await deletePrivateFile(invoice.faktur_pajak_url);

    return NextResponse.json({ success: true, message: "Lampiran faktur pajak dihapus" });
  } catch (err) {
    console.error("[finance] delete faktur pajak error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus faktur pajak" },
      { status: 500 }
    );
  }
}
