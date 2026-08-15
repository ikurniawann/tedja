import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { accountingCompanyId } from "@/lib/accounting/company-scope";
import { getAccountingDashboard } from "@/lib/accounting/dashboard-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${today().slice(0, 4)}-01-01`;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      return NextResponse.json({ data: null });
    }

    const { searchParams } = new URL(request.url);
    const asOf = searchParams.get("as_of")?.trim() || today();
    const dateFrom = searchParams.get("date_from")?.trim() || yearStart();
    const dateTo = searchParams.get("date_to")?.trim() || asOf;

    const data = await getAccountingDashboard(companyId, {
      asOf,
      dateFrom,
      dateTo,
    });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/dashboard] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
