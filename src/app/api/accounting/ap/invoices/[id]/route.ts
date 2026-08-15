import { NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { getApInvoiceById } from "@/lib/accounting/ap-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const row = await getApInvoiceById(id);
    if (!row) {
      return NextResponse.json(
        { success: false, message: "AP invoice tidak ditemukan" },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: row });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/ap/invoices/[id]", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
