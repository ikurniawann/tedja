import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { FISCAL_PERIOD_STATUSES } from "@/lib/accounting/fiscal-types";
import {
  getFiscalYear,
  softDeleteFiscalYear,
  updateFiscalYearRecord,
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

interface RouteParams {
  params: Promise<{ id: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const scope = await getApiUserScope();
    const data = await getFiscalYear(id);
    if (!data) throw ApiError.notFound("Fiscal year tidak ditemukan");
    if (data.company_id != null && !isRowInBusinessScope(scope, data)) {
      throw ApiError.forbidden("Fiscal year di luar scope");
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/fiscal-years/:id] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const body = payloadSchema.parse(await request.json());
    const scope = await getApiUserScope();

    const existing = await getFiscalYear(id);
    if (!existing) throw ApiError.notFound("Fiscal year tidak ditemukan");
    if (existing.company_id == null && scope && !scope.isUnscoped) {
      throw ApiError.forbidden("Tidak dapat mengubah fiscal year global");
    }
    if (
      existing.company_id != null &&
      !isRowInBusinessScope(scope, existing)
    ) {
      throw ApiError.forbidden("Fiscal year di luar scope");
    }

    try {
      const data = await updateFiscalYearRecord({
        id,
        userId: user.id,
        payload: {
          code: body.code.trim().toUpperCase(),
          name: body.name.trim(),
          start_date: body.start_date,
          end_date: body.end_date,
          is_active: body.is_active ?? true,
          periods: body.periods,
        },
      });
      return NextResponse.json({
        data,
        message: "Fiscal year berhasil diperbarui",
      });
    } catch (error) {
      const msg = errMsg(error);
      if (
        /duplicate|unique/i.test(msg) ||
        (error as { code?: string }).code === "23505"
      ) {
        throw ApiError.badRequest("Kode fiscal year sudah dipakai");
      }
      if (/period|tanggal|end_date|journal|dipakai|OPEN|CLOSED|Closing|Tutup|fiscal/i.test(msg)) {
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
    console.error("[accounting/fiscal-years/:id] PUT", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const scope = await getApiUserScope();

    const existing = await getFiscalYear(id);
    if (!existing) throw ApiError.notFound("Fiscal year tidak ditemukan");
    if (existing.company_id == null && scope && !scope.isUnscoped) {
      throw ApiError.forbidden("Tidak dapat menghapus fiscal year global");
    }
    if (
      existing.company_id != null &&
      !isRowInBusinessScope(scope, existing)
    ) {
      throw ApiError.forbidden("Fiscal year di luar scope");
    }

    try {
      await softDeleteFiscalYear(id, user.id);
      return NextResponse.json({ message: "Fiscal year berhasil dihapus" });
    } catch (error) {
      const msg = errMsg(error);
      if (/dipakai|journal/i.test(msg)) throw ApiError.badRequest(msg);
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/fiscal-years/:id] DELETE", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
