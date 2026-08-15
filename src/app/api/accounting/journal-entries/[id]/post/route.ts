import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import {
  getJournalEntry,
  postJournalEntry,
} from "@/lib/accounting/journal-entry-store";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const scope = await getApiUserScope();

    const existing = await getJournalEntry(id);
    if (!existing) throw ApiError.notFound("Journal entry tidak ditemukan");
    if (
      existing.company_id != null &&
      !isRowInBusinessScope(scope, existing)
    ) {
      throw ApiError.forbidden("Journal entry di luar scope");
    }

    try {
      const data = await postJournalEntry(id, user.id);
      return NextResponse.json({
        data,
        message: "Journal entry berhasil diposting",
      });
    } catch (error) {
      const msg = errMsg(error);
      if (/fiscal|balance|Minimal|POSTED|recon|period/i.test(msg)) {
        throw ApiError.badRequest(msg);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/journal-entries/:id/post] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
