import { NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import {
  createArInvoiceFromSalesInvoice,
  getArInvoiceBySalesInvoiceId,
} from "@/lib/accounting/ar-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ salesInvoiceId: string }> }
) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { salesInvoiceId } = await params;
    let row = await getArInvoiceBySalesInvoiceId(salesInvoiceId);
    if (!row) {
      try {
        const created = await createArInvoiceFromSalesInvoice({
          salesInvoiceId,
          userId: user.id,
        });
        row = created.invoice;
      } catch {
        // leave null
      }
    }
    if (!row) {
      return NextResponse.json(
        { success: false, message: "AR invoice tidak ditemukan untuk B2B ini" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: row });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
