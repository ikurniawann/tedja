import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import {
  createCashMovement,
  listCashMovements,
} from "@/lib/accounting/cash-bank-store";

const createSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  cash_account_id: z.string().uuid(),
  offset_account_id: z.string().uuid(),
  description: z.string().trim().max(300).optional().nullable(),
  memo: z.string().trim().max(200).optional().nullable(),
});

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function mapBiz(msg: string): never {
  if (
    /fiscal|amount|akun|kas|bank|lawan|postable|period|balance/i.test(msg)
  ) {
    throw ApiError.badRequest(msg);
  }
  throw new Error(msg);
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const sp = request.nextUrl.searchParams;
    const result = await listCashMovements({
      companyId,
      kind: "cash_in",
      search: sp.get("search") || undefined,
      dateFrom: sp.get("date_from") || undefined,
      dateTo: sp.get("date_to") || undefined,
      limit: Number(sp.get("limit") || 50),
      offset: Number(sp.get("offset") || 0),
    });
    return NextResponse.json({
      success: true,
      data: result.rows,
      meta: { total: result.total },
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/cash-bank/cash-in", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const body = createSchema.parse(await request.json());

    try {
      const data = await createCashMovement({
        userId: user.id,
        companyId,
        kind: "cash_in",
        entryDate: body.entry_date,
        amount: body.amount,
        cashAccountId: body.cash_account_id,
        offsetAccountId: body.offset_account_id,
        description: body.description,
        memo: body.memo,
      });
      return NextResponse.json(
        { success: true, data, message: "Cash In berhasil dicatat & diposting" },
        { status: 201 }
      );
    } catch (e) {
      mapBiz(errMsg(e));
    }
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Validation failed" },
        { status: 400 }
      );
    }
    console.error("POST /api/accounting/cash-bank/cash-in", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
