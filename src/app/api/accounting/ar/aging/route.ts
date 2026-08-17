import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listArAging, syncArFromOpenSalesInvoices } from "@/lib/accounting/ar-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    await syncArFromOpenSalesInvoices({
      companyId,
      userId: user.id,
      limit: 30,
    });
    const asOf = request.nextUrl.searchParams.get("as_of") || undefined;
    const data = await listArAging({ companyId, asOf });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/ar/aging", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
