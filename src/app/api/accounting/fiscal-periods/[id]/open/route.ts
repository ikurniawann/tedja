import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { openFiscalPeriodById } from "@/lib/accounting/fiscal";
import { queryOne } from "@/lib/db";

const bodySchema = z.object({
  close_previous: z.boolean().optional().default(true),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);

    const row = await queryOne<{
      id: string;
      company_id: string | null;
    }>(
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
      const data = await openFiscalPeriodById({
        periodId: id,
        userId: user.id,
        companyId,
        closePrevious: body.close_previous ?? true,
      });
      return NextResponse.json({
        data,
        message: `Period ${data.name} berhasil dibuka`,
      });
    } catch (error) {
      const msg = errMsg(error);
      if (/OPEN|CLOSED|Tutup|fiscal|scope|aktif|ditemukan/i.test(msg)) {
        throw ApiError.badRequest(msg);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("[accounting/fiscal-periods/:id/open] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
