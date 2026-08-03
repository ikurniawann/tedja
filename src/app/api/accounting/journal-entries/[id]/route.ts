import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import { JOURNAL_LINE_SIDES } from "@/lib/accounting/fiscal-types";
import {
  getJournalEntry,
  softDeleteJournalEntry,
  updateJournalEntryRecord,
} from "@/lib/accounting/journal-entry-store";

const lineSchema = z.object({
  id: z.string().uuid().optional(),
  account_id: z.string().uuid(),
  entry_side: z.enum([...JOURNAL_LINE_SIDES]),
  amount: z.number().positive(),
  memo: z.string().trim().nullable().optional(),
  sort_order: z.number().int().optional(),
});

const payloadSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().nullable().optional(),
  lines: z.array(lineSchema).min(2),
  post: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function mapBizError(msg: string): never {
  if (
    /fiscal|balance|postable|Minimal|Amount|Debit|Credit|akun|period|recon|POSTED|tidak bisa/i.test(
      msg
    )
  ) {
    throw ApiError.badRequest(msg);
  }
  throw new Error(msg);
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const scope = await getApiUserScope();
    const data = await getJournalEntry(id);
    if (!data) throw ApiError.notFound("Journal entry tidak ditemukan");
    if (data.company_id != null && !isRowInBusinessScope(scope, data)) {
      throw ApiError.forbidden("Journal entry di luar scope");
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/journal-entries/:id] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const body = payloadSchema.parse(await request.json());
    const scope = await getApiUserScope();

    const existing = await getJournalEntry(id);
    if (!existing) throw ApiError.notFound("Journal entry tidak ditemukan");
    if (existing.company_id == null && scope && !scope.isUnscoped) {
      throw ApiError.forbidden("Tidak dapat mengubah journal entry global");
    }
    if (
      existing.company_id != null &&
      !isRowInBusinessScope(scope, existing)
    ) {
      throw ApiError.forbidden("Journal entry di luar scope");
    }

    try {
      const companyId =
        existing.company_id ?? (requireAccountingCompanyId(scope));
      const data = await updateJournalEntryRecord({
        id,
        userId: user.id,
        companyId,
        entry_date: body.entry_date,
        description: body.description?.trim() || null,
        lines: body.lines,
        post: body.post ?? false,
      });
      return NextResponse.json({
        data,
        message: body.post
          ? "Journal entry berhasil diposting"
          : "Journal entry berhasil diperbarui",
      });
    } catch (error) {
      mapBizError(errMsg(error));
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("[accounting/journal-entries/:id] PUT", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const scope = await getApiUserScope();

    const existing = await getJournalEntry(id);
    if (!existing) throw ApiError.notFound("Journal entry tidak ditemukan");
    if (existing.company_id == null && scope && !scope.isUnscoped) {
      throw ApiError.forbidden("Tidak dapat menghapus journal entry global");
    }
    if (
      existing.company_id != null &&
      !isRowInBusinessScope(scope, existing)
    ) {
      throw ApiError.forbidden("Journal entry di luar scope");
    }

    try {
      await softDeleteJournalEntry(id, user.id);
      return NextResponse.json({ message: "Journal entry berhasil dihapus" });
    } catch (error) {
      mapBizError(errMsg(error));
    }
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/journal-entries/:id] DELETE", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
