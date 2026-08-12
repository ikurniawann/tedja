import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listApInvoices } from "@/lib/accounting/ap-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const sp = request.nextUrl.searchParams;
    const result = await listApInvoices({
      companyId,
      status: sp.get("status") || undefined,
      paymentStatus: sp.get("payment_status") || undefined,
      search: sp.get("search") || undefined,
      limit: Number(sp.get("limit") || 20),
      offset: Number(sp.get("offset") || 0),
    });
    return NextResponse.json({
      success: true,
      data: result.rows,
      meta: { total: result.total },
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/ap/invoices", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
