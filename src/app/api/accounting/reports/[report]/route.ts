import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { accountingCompanyId } from "@/lib/accounting/company-scope";
import {
  getBalanceSheetReport,
  getCashFlowReport,
  getGeneralLedgerReport,
  getIncomeStatementReport,
  getTrialBalanceReport,
  listGeneralLedgerAccounts,
} from "@/lib/accounting/reports-store";

interface RouteParams {
  params: Promise<{ report: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${today().slice(0, 4)}-01-01`;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { report } = await params;
    const scope = await getApiUserScope();
    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      return NextResponse.json({ data: null });
    }

    const { searchParams } = new URL(request.url);
    const asOf = searchParams.get("as_of")?.trim() || today();
    const dateFrom = searchParams.get("date_from")?.trim() || yearStart();
    const dateTo = searchParams.get("date_to")?.trim() || today();
    const accountId = searchParams.get("account_id")?.trim() || undefined;

    switch (report) {
      case "trial-balance": {
        const data = await getTrialBalanceReport(companyId, asOf);
        return NextResponse.json({ data });
      }
      case "balance-sheet": {
        const data = await getBalanceSheetReport(companyId, asOf);
        return NextResponse.json({ data });
      }
      case "income-statement": {
        const data = await getIncomeStatementReport(
          companyId,
          dateFrom,
          dateTo
        );
        return NextResponse.json({ data });
      }
      case "cash-flow": {
        const data = await getCashFlowReport(companyId, dateFrom, dateTo);
        return NextResponse.json({ data });
      }
      case "general-ledger": {
        if (accountId) {
          const data = await getGeneralLedgerReport({
            companyId,
            accountId,
            dateFrom: searchParams.get("date_from")?.trim() || undefined,
            dateTo: searchParams.get("date_to")?.trim() || undefined,
          });
          if (!data) throw ApiError.notFound("Akun tidak ditemukan");
          return NextResponse.json({ data });
        }
        const data = await listGeneralLedgerAccounts(companyId, asOf);
        return NextResponse.json({ data });
      }
      default:
        throw ApiError.notFound("Report tidak ditemukan");
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/reports/:report] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
