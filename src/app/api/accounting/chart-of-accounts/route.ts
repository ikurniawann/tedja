import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  getApiUserScope,
  isRowInBusinessScope,
} from "@/lib/api/scope";
import {
  formatAccountCodeDisplay,
  inferAccountLevel,
  normalizeAccountCode,
} from "@/lib/accounting/account-code";
import {
  accountingCompanyId,
  requireAccountingCompanyId,
} from "@/lib/accounting/company-scope";
import { recomputePostableChain } from "@/lib/accounting/coa-postable";
import {
  ACCOUNTING_API_ROLES,
  CASH_FLOW_CATEGORIES,
} from "@/lib/accounting/coa-types";

const SELECT = `
  id, company_id, code, name, parent_id, account_type_id, level,
  is_postable, is_contra, is_cash_bank, cash_flow_category, description, is_active,
  created_at, updated_at,
  account_types ( id, code, name, normal_balance )
`.replace(/\s+/g, " ");

const payloadSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  parent_id: z.string().uuid().nullable().optional(),
  account_type_id: z.string().uuid(),
  is_contra: z.boolean().optional(),
  is_cash_bank: z.boolean().optional(),
  cash_flow_category: z
    .enum([...CASH_FLOW_CATEGORIES])
    .nullable()
    .optional(),
  description: z.string().trim().nullable().optional(),
  is_active: z.boolean().optional(),
});

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

function mapRow(row: Record<string, unknown>) {
  const type = row.account_types as
    | { id: string; code: string; name: string; normal_balance: string }
    | null
    | undefined;
  return {
    id: row.id,
    company_id: row.company_id,
    code: row.code,
    code_display: formatAccountCodeDisplay(String(row.code)),
    name: row.name,
    parent_id: row.parent_id,
    account_type_id: row.account_type_id,
    account_type_code: type?.code ?? null,
    account_type_name: type?.name ?? null,
    normal_balance: type?.normal_balance ?? null,
    level: row.level,
    is_postable: row.is_postable,
    is_contra: row.is_contra,
    is_cash_bank: row.is_cash_bank,
    cash_flow_category: row.cash_flow_category,
    description: row.description,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const typeId = searchParams.get("account_type_id");
    const postable = searchParams.get("is_postable");
    const contra = searchParams.get("is_contra");
    const cashBank = searchParams.get("is_cash_bank");
    const cashFlow = searchParams.get("cash_flow_category");
    const active = searchParams.get("is_active");

    let q = db
      .from("chart_of_accounts", "accounting")
      .select(SELECT)
      .is("deleted_at", null)
      .order("code", { ascending: true });

    const companyId = accountingCompanyId(scope);
    if (!companyId) {
      return NextResponse.json({ data: [] });
    }
    q = q.eq("company_id", companyId);

    if (typeId) q = q.eq("account_type_id", typeId);
    if (postable === "true") q = q.eq("is_postable", true);
    if (postable === "false") q = q.eq("is_postable", false);
    if (contra === "true") q = q.eq("is_contra", true);
    if (contra === "false") q = q.eq("is_contra", false);
    if (cashBank === "true") q = q.eq("is_cash_bank", true);
    if (cashBank === "false") q = q.eq("is_cash_bank", false);
    if (cashFlow) q = q.eq("cash_flow_category", cashFlow);
    if (active === "true") q = q.eq("is_active", true);
    if (active === "false") q = q.eq("is_active", false);

    if (search) {
      q = q.or(`code.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({
      data: ((data ?? []) as Record<string, unknown>[]).map((row) => mapRow(row)),
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/coa] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const body = payloadSchema.parse(await request.json());
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const companyId = requireAccountingCompanyId(scope);

    const code = normalizeAccountCode(body.code);
    if (!code) throw ApiError.badRequest("Format kode akun tidak valid");
    const level = inferAccountLevel(code);
    if (!level) throw ApiError.badRequest("Level kode akun tidak dikenali");

    if (body.parent_id) {
      const { data: parent } = await db
        .from("chart_of_accounts", "accounting")
        .select("id, company_id, level, deleted_at")
        .eq("id", body.parent_id)
        .maybeSingle();

      if (!parent || parent.deleted_at) {
        throw ApiError.badRequest("Parent akun tidak ditemukan");
      }
      if (!isRowInBusinessScope(scope, parent)) {
        throw ApiError.forbidden("Parent di luar scope");
      }
      if ((parent.company_id ?? null) !== companyId) {
        throw ApiError.badRequest("Parent harus dalam company yang sama");
      }
    }

    const { data, error } = await db
      .from("chart_of_accounts", "accounting")
      .insert({
        company_id: companyId,
        code,
        name: body.name.trim(),
        parent_id: body.parent_id ?? null,
        account_type_id: body.account_type_id,
        level,
        is_postable: true,
        is_contra: body.is_contra ?? false,
        is_cash_bank: body.is_cash_bank ?? false,
        cash_flow_category: body.cash_flow_category ?? null,
        description: body.description?.trim() || null,
        is_active: body.is_active ?? true,
        created_by: user.id,
        updated_by: user.id,
      })
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        throw ApiError.badRequest("Kode akun sudah digunakan");
      }
      throw error;
    }

    await recomputePostableChain(body.parent_id ?? null);
    await recomputePostableChain(data.id);

    const { data: refreshed } = await db
      .from("chart_of_accounts", "accounting")
      .select(SELECT)
      .eq("id", data.id)
      .single();

    return NextResponse.json(
      {
        data: mapRow((refreshed ?? data) as Record<string, unknown>),
        message: "Akun berhasil ditambahkan",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("[accounting/coa] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
