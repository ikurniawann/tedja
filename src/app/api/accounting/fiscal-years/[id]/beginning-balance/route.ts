import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { JOURNAL_LINE_SIDES } from "@/lib/accounting/fiscal-types";
import {
  getBeginningBalanceSuggestion,
  saveBeginningBalance,
} from "@/lib/accounting/beginning-balance-store";
import { getFiscalYear } from "@/lib/accounting/fiscal-year-store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const saveSchema = z.object({
  retained_earnings_account_id: z.string().uuid().nullable().optional(),
  lines: z
    .array(
      z.object({
        account_id: z.string().uuid(),
        entry_side: z.enum([...JOURNAL_LINE_SIDES]),
        amount: z.number().positive(),
        memo: z.string().trim().nullable().optional(),
      })
    )
    .min(2),
  post: z.boolean().optional(),
});

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const scope = await getApiUserScope();

    const year = await getFiscalYear(id);
    if (!year) throw ApiError.notFound("Fiscal year tidak ditemukan");
    if (year.company_id != null && !isRowInBusinessScope(scope, year)) {
      throw ApiError.forbidden("Fiscal year di luar scope");
    }

    const data = await getBeginningBalanceSuggestion(id);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[fiscal-years/:id/beginning-balance] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const body = saveSchema.parse(await request.json());
    const scope = await getApiUserScope();

    const year = await getFiscalYear(id);
    if (!year) throw ApiError.notFound("Fiscal year tidak ditemukan");
    if (year.company_id != null && !isRowInBusinessScope(scope, year)) {
      throw ApiError.forbidden("Fiscal year di luar scope");
    }
    if (year.company_id == null && scope && !scope.isUnscoped) {
      throw ApiError.forbidden("Tidak dapat mengubah fiscal year global");
    }

    try {
      const result = await saveBeginningBalance({
        fiscalYearId: id,
        userId: user.id,
        payload: {
          retained_earnings_account_id:
            body.retained_earnings_account_id ?? null,
          lines: body.lines,
          post: body.post ?? false,
        },
      });
      return NextResponse.json({
        data: result,
        message: body.post
          ? "Beginning balance berhasil diposting"
          : "Beginning balance draft berhasil disimpan",
      });
    } catch (error) {
      const msg = errMsg(error);
      if (
        /balance|Minimal|POSTED|period|Retained|fiscal|tidak/i.test(msg)
      ) {
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
    console.error("[fiscal-years/:id/beginning-balance] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
