import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import {
  JOURNAL_AMOUNT_SOURCES,
  JOURNAL_ENTRY_SIDES,
  JOURNAL_EVENT_META,
  JOURNAL_MODULES,
} from "@/lib/accounting/journal-mapping-types";
import {
  getJournalMapping,
  softDeleteJournalMapping,
  updateJournalMappingRecord,
} from "@/lib/accounting/journal-mapping-store";

const lineSchema = z.object({
  id: z.string().uuid().optional(),
  entry_side: z.enum([...JOURNAL_ENTRY_SIDES]),
  line_role: z.string().trim().min(1).max(40),
  account_id: z.string().uuid().nullable().optional(),
  amount_source: z.enum([...JOURNAL_AMOUNT_SOURCES]),
  sort_order: z.number().int().optional(),
  is_required: z.boolean().optional(),
});

const payloadSchema = z.object({
  event_code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().nullable().optional(),
  module: z.enum([...JOURNAL_MODULES]),
  is_active: z.boolean().optional(),
  lines: z.array(lineSchema).min(1),
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
    const data = await getJournalMapping(id);
    if (!data) throw ApiError.notFound("Journal mapping tidak ditemukan");
    // Scoped users may read global templates; company rows must match scope
    if (
      data.company_id != null &&
      !isRowInBusinessScope(scope, data)
    ) {
      throw ApiError.forbidden("Mapping di luar scope");
    }
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/journal-mappings/:id] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const body = payloadSchema.parse(await request.json());
    const scope = await getApiUserScope();

    const existing = await getJournalMapping(id);
    if (!existing) throw ApiError.notFound("Journal mapping tidak ditemukan");
    if (existing.company_id == null && scope && !scope.isUnscoped) {
      throw ApiError.forbidden("Tidak dapat mengubah template global");
    }
    if (
      existing.company_id != null &&
      !isRowInBusinessScope(scope, existing)
    ) {
      throw ApiError.forbidden("Mapping di luar scope");
    }

    const eventCode = body.event_code.trim().toUpperCase();
    const meta = JOURNAL_EVENT_META[
      eventCode as keyof typeof JOURNAL_EVENT_META
    ];

    try {
      const data = await updateJournalMappingRecord({
        id,
        userId: user.id,
        event_code: eventCode,
        name: body.name.trim() || meta?.name || eventCode,
        description: body.description?.trim() || null,
        module: body.module,
        is_active: body.is_active ?? true,
        lines: body.lines,
        existingCompanyId: existing.company_id,
      });

      return NextResponse.json({
        data,
        message: "Journal mapping berhasil diperbarui",
      });
    } catch (error) {
      const msg = errMsg(error);
      if (/duplicate|unique/i.test(msg) || (error as { code?: string }).code === "23505") {
        throw ApiError.badRequest("Event code sudah digunakan");
      }
      if (/postable|tidak ditemukan|company yang sama|dihapus/i.test(msg)) {
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
    console.error("[accounting/journal-mappings/:id] PUT", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const scope = await getApiUserScope();

    const existing = await getJournalMapping(id);
    if (!existing) throw ApiError.notFound("Journal mapping tidak ditemukan");
    if (existing.company_id == null && scope && !scope.isUnscoped) {
      throw ApiError.forbidden("Tidak dapat menghapus template global");
    }
    if (!isRowInBusinessScope(scope, existing) && existing.company_id != null) {
      throw ApiError.forbidden("Mapping di luar scope");
    }

    await softDeleteJournalMapping(id, user.id);
    return NextResponse.json({ message: "Journal mapping berhasil dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/journal-mappings/:id] DELETE", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
