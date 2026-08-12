import { NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { listApPayableRegister } from "@/lib/accounting/ap-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET() {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const rows = await listApPayableRegister({ companyId });
    return NextResponse.json({ success: true, data: rows });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/ap/payable", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
