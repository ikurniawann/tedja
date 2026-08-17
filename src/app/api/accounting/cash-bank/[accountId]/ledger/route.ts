import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { accountingCompanyId } from "@/lib/accounting/company-scope";
import { getCashBankLedger } from "@/lib/accounting/cash-bank-store";

interface RouteParams {
  params: Promise<{ accountId: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const { accountId } = await params;
    const scope = await getApiUserScope();
    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      throw ApiError.badRequest(
        "Akun Anda belum terikat company. Data Cash & Bank hanya untuk company user yang login."
      );
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("date_from")?.trim() || undefined;
    const dateTo = searchParams.get("date_to")?.trim() || undefined;

    const data = await getCashBankLedger({
      companyId,
      accountId,
      dateFrom,
      dateTo,
    });
    if (!data) throw ApiError.notFound("Akun kas/bank tidak ditemukan");

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/cash-bank/:accountId/ledger] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
