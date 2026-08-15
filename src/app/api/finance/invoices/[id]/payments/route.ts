import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { requireFinanceRole, type FinanceUser } from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";

// GET payments tetap; POST deprecated → Accounting AR Receipt.

type InvoiceRow = {
  id: string;
  deal_id: string;
  status: string;
  company_id: string;
  branch_id: string;
};

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
        {
          success: false,
          error: forbidden
            ? "Insufficient permissions"
            : "Invoice tidak ditemukan",
        },
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireFinanceRole();
  if (error) return error;
  await params;
  return NextResponse.json(
    {
      success: false,
      error:
        "Penerimaan piutang dipindah ke Accounting → Accounts Receivable → Receipt. Gunakan /dashboard/accounting/receivable/receipts",
      redirect: "/dashboard/accounting/receivable/receipts",
    },
    { status: 410 }
  );
}
