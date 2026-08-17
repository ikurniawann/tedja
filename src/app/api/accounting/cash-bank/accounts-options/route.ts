import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listPostableAccounts } from "@/lib/accounting/cash-bank-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const data = await listPostableAccounts(companyId);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/cash-bank/accounts-options", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
