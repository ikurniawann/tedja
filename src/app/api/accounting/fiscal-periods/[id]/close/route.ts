import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import {
  closeFiscalPeriodById,
  getPeriodClosePreview,
} from "@/lib/accounting/fiscal";
import { queryOne } from "@/lib/db";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function mapBiz(msg: string): never {
  if (/OPEN|CLOSED|DRAFT|Tutup|fiscal|scope|aktif|ditemukan|jurnal/i.test(msg)) {
    throw ApiError.badRequest(msg);
  }
  throw new Error(msg);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);

    const row = await queryOne<{ id: string; company_id: string | null }>(
      `SELECT p.id, y.company_id
       FROM accounting.fiscal_periods p
       JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
       WHERE p.id = $1 AND y.deleted_at IS NULL`,
      [id]
    );
    if (!row) throw ApiError.notFound("Fiscal period tidak ditemukan");
    if (row.company_id != null && !isRowInBusinessScope(scope, row)) {
      throw ApiError.forbidden("Fiscal period di luar scope");
    }

    const data = await getPeriodClosePreview({
      periodId: id,
      companyId,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/fiscal-periods/:id/close", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);

    const row = await queryOne<{ id: string; company_id: string | null }>(
      `SELECT p.id, y.company_id
       FROM accounting.fiscal_periods p
       JOIN accounting.fiscal_years y ON y.id = p.fiscal_year_id
       WHERE p.id = $1 AND y.deleted_at IS NULL`,
      [id]
    );
    if (!row) throw ApiError.notFound("Fiscal period tidak ditemukan");
    if (row.company_id != null && !isRowInBusinessScope(scope, row)) {
      throw ApiError.forbidden("Fiscal period di luar scope");
    }

    try {
      const data = await closeFiscalPeriodById({
        periodId: id,
        userId: user.id,
        companyId,
      });
      return NextResponse.json({
        success: true,
        data,
        message: `Period ${data.name} berhasil ditutup`,
      });
    } catch (e) {
      mapBiz(errMsg(e));
    }
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("POST /api/accounting/fiscal-periods/:id/close", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
