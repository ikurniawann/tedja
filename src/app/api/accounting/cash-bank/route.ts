import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { accountingCompanyId } from "@/lib/accounting/company-scope";
import { listCashBankAccounts } from "@/lib/accounting/cash-bank-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      return NextResponse.json({ data: [] });
    }
    const data = await listCashBankAccounts(companyId);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/cash-bank] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
