import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";
import { requireAccountingCompanyId } from "@/lib/accounting/company-scope";
import {
  getSubsidiaryLedger,
  listSubsidiaryParties,
  SUBSIDIARY_KINDS,
  type SubsidiaryKind,
} from "@/lib/accounting/subsidiary-ledger-store";

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function yearStart() {
  return `${today().slice(0, 4)}-01-01`;
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([...ACCOUNTING_API_ROLES]);
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);
    const sp = request.nextUrl.searchParams;
    const kindRaw = (sp.get("kind") || "AP").toUpperCase();
    if (!(SUBSIDIARY_KINDS as readonly string[]).includes(kindRaw)) {
      throw ApiError.badRequest("kind harus AP atau AR");
    }
    const kind = kindRaw as SubsidiaryKind;
    const partyKey = sp.get("party_key")?.trim() || undefined;

    if (!partyKey) {
      const data = await listSubsidiaryParties(companyId, kind);
      return NextResponse.json({ success: true, data });
    }

    const data = await getSubsidiaryLedger({
      companyId,
      kind,
      partyKey,
      dateFrom: sp.get("date_from")?.trim() || yearStart(),
      dateTo: sp.get("date_to")?.trim() || today(),
    });
    if (!data) throw ApiError.notFound("Party tidak ditemukan");
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("GET /api/accounting/ledger/subsidiary", error);
    return NextResponse.json(
      { success: false, message: errMsg(error) },
      { status: 500 }
    );
  }
}
