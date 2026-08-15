import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { AR_RECEIPT_METHODS } from "@/lib/accounting/ar-types";
import { listArReceipts, recordArReceipt } from "@/lib/accounting/ar-store";
import { AccountingPostError } from "@/lib/accounting/journal-mapping-posting";

const createSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
  receipt_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  method: z.enum(AR_RECEIPT_METHODS).optional(),
  reference_number: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const sp = request.nextUrl.searchParams;
    const result = await listArReceipts({
      companyId,
      search: sp.get("search") || undefined,
      limit: Number(sp.get("limit") || 20),
      offset: Number(sp.get("offset") || 0),
    });
    return NextResponse.json({
      success: true,
      data: result.rows,
      meta: { total: result.total },
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/ar/receipts", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    requireAccountingCompanyId(scope);
    const body = createSchema.parse(await request.json());
    const result = await recordArReceipt({
      userId: user.id,
      invoiceId: body.invoice_id,
      amount: body.amount,
      receiptDate: body.receipt_date,
      method: body.method,
      referenceNumber: body.reference_number,
      notes: body.notes,
    });
    const base = "Penerimaan AR berhasil dicatat";
    return NextResponse.json(
      {
        success: true,
        data: result.receipt,
        invoice: result.invoice,
        message: result.note ? `${base} (${result.note})` : base,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof AccountingPostError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 500 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, message: "Validation failed" },
        { status: 400 }
      );
    }
    const message = errMsg(error);
    const status = /melebihi|harus|tidak ditemukan|POSTED/i.test(message)
      ? 400
      : 500;
    console.error("POST /api/accounting/ar/receipts", error);
    return NextResponse.json({ success: false, message }, { status });
  }
}
