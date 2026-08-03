import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import {
  accountingCompanyId,
  requireAccountingCompanyId,
} from "@/lib/accounting/company-scope";
import { FISCAL_PERIOD_STATUSES } from "@/lib/accounting/fiscal-types";
import { resolveFiscalCoverage } from "@/lib/accounting/fiscal";
import {
  createFiscalYearRecord,
  listFiscalYears,
} from "@/lib/accounting/fiscal-year-store";

const periodSchema = z.object({
  id: z.string().uuid().optional(),
  period_no: z.number().int().min(1).max(12),
  name: z.string().trim().min(1).max(60),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum([...FISCAL_PERIOD_STATUSES]),
});

const payloadSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_active: z.boolean().optional(),
  periods: z.array(periodSchema).min(1).max(12),
});

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);
    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      if (searchParams.get("coverage") === "1") {
        return NextResponse.json({
          data: {
            date:
              searchParams.get("date")?.trim() ||
              new Date().toISOString().slice(0, 10),
            ready: false,
            period: null,
            suggestion: null,
          },
        });
      }
      return NextResponse.json({ data: [] });
    }

    if (searchParams.get("coverage") === "1") {
      const date =
        searchParams.get("date")?.trim() ||
        new Date().toISOString().slice(0, 10);
      const data = await resolveFiscalCoverage(date, companyId);
      return NextResponse.json({ data });
    }

    const data = await listFiscalYears({
      search: searchParams.get("search")?.trim() || undefined,
      isActive: searchParams.get("is_active") || undefined,
      companyScopeOr: `company_id.eq.${companyId}`,
    });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/fiscal-years] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const body = payloadSchema.parse(await request.json());
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);

    try {
      const data = await createFiscalYearRecord({
        userId: user.id,
        companyId,
        payload: {
          code: body.code.trim().toUpperCase(),
          name: body.name.trim(),
          start_date: body.start_date,
          end_date: body.end_date,
          is_active: body.is_active ?? true,
          periods: body.periods,
        },
      });
      return NextResponse.json(
        { data, message: "Fiscal year berhasil ditambahkan" },
        { status: 201 }
      );
    } catch (error) {
      const msg = errMsg(error);
      if (
        /duplicate|unique/i.test(msg) ||
        (error as { code?: string }).code === "23505"
      ) {
        throw ApiError.badRequest("Kode fiscal year sudah dipakai");
      }
      if (/period|tanggal|end_date|start_date|1–12|1-12|OPEN|CLOSED|Closing|Tutup|fiscal/i.test(msg)) {
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
    console.error("[accounting/fiscal-years] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
