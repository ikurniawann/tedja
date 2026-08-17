import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import {
  accountingCompanyId,
  requireAccountingCompanyId,
} from "@/lib/accounting/company-scope";
import { JOURNAL_LINE_SIDES } from "@/lib/accounting/fiscal-types";
import {
  createJournalEntryRecord,
  listJournalEntries,
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

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function mapBizError(msg: string): never {
  if (
    /fiscal|balance|postable|Minimal|Amount|Debit|Credit|akun|period|recon|POSTED/i.test(
      msg
    )
  ) {
    throw ApiError.badRequest(msg);
  }
  throw new Error(msg);
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);

    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      return NextResponse.json({ data: [] });
    }
    const data = await listJournalEntries({
      search: searchParams.get("search")?.trim() || undefined,
      status: searchParams.get("status") || undefined,
      dateFrom: searchParams.get("date_from") || undefined,
      dateTo: searchParams.get("date_to") || undefined,
      entryType: searchParams.get("entry_type") || undefined,
      accountId: searchParams.get("account_id") || undefined,
      companyScopeOr: `company_id.eq.${companyId}`,
    });

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/journal-entries] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const body = payloadSchema.parse(await request.json());
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);

    try {
      const data = await createJournalEntryRecord({
        userId: user.id,
        companyId,
        entry_date: body.entry_date,
        description: body.description?.trim() || null,
        // is_recon hanya di-set dari proses rekonsiliasi
        is_recon: false,
        lines: body.lines,
        post: body.post ?? false,
      });
      return NextResponse.json(
        {
          data,
          message: body.post
            ? "Journal entry berhasil diposting"
            : "Journal entry draft berhasil disimpan",
        },
        { status: 201 }
      );
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
    console.error("[accounting/journal-entries] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
