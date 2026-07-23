import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiRole } from "@/lib/api/auth";
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
import { recomputePostableChain } from "@/lib/accounting/coa-postable";
import {
  ACCOUNTING_API_ROLES,
  CASH_FLOW_CATEGORIES,
} from "@/lib/accounting/coa-types";

const SELECT = `
  id, company_id, code, name, parent_id, account_type_id, level,
  is_postable, is_contra, cash_flow_category, description, is_active,
  created_at, updated_at,
  account_types ( id, code, name, normal_balance )
`.replace(/\s+/g, " ");

const payloadSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  parent_id: z.string().uuid().nullable().optional(),
  account_type_id: z.string().uuid(),
  is_contra: z.boolean().optional(),
  cash_flow_category: z
    .enum([...CASH_FLOW_CATEGORIES])
    .nullable()
    .optional(),
  description: z.string().trim().nullable().optional(),
  is_active: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

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
    cash_flow_category: row.cash_flow_category,
    description: row.description,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const body = payloadSchema.parse(await request.json());
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: existing } = await db
      .from("chart_of_accounts", "accounting")
      .select("id, company_id, parent_id, deleted_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing || existing.deleted_at) {
      throw ApiError.notFound("Akun tidak ditemukan");
    }
    if (!isRowInBusinessScope(scope, existing)) {
      throw ApiError.forbidden("Akun di luar scope");
    }

    const code = normalizeAccountCode(body.code);
    if (!code) throw ApiError.badRequest("Format kode akun tidak valid");
    const level = inferAccountLevel(code);
    if (!level) throw ApiError.badRequest("Level kode akun tidak dikenali");

    if (body.parent_id === id) {
      throw ApiError.badRequest("Parent tidak boleh akun itu sendiri");
    }

    const oldParentId = existing.parent_id as string | null;

    const { data, error } = await db
      .from("chart_of_accounts", "accounting")
      .update({
        code,
        name: body.name.trim(),
        parent_id: body.parent_id ?? null,
        account_type_id: body.account_type_id,
        level,
        is_contra: body.is_contra ?? false,
        cash_flow_category: body.cash_flow_category ?? null,
        description: body.description?.trim() || null,
        is_active: body.is_active ?? true,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        throw ApiError.badRequest("Kode akun sudah digunakan");
      }
      throw error;
    }

    await recomputePostableChain(oldParentId);
    await recomputePostableChain(body.parent_id ?? null);
    await recomputePostableChain(id);

    const { data: refreshed } = await db
      .from("chart_of_accounts", "accounting")
      .select(SELECT)
      .eq("id", id)
      .single();

    return NextResponse.json({
      data: mapRow((refreshed ?? data) as Record<string, unknown>),
      message: "Akun berhasil diperbarui",
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("[accounting/coa] PUT", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireApiRole([...ACCOUNTING_API_ROLES]);
    const { id } = await params;
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: existing } = await db
      .from("chart_of_accounts", "accounting")
      .select("id, company_id, parent_id, deleted_at")
      .eq("id", id)
      .maybeSingle();

    if (!existing || existing.deleted_at) {
      throw ApiError.notFound("Akun tidak ditemukan");
    }
    if (!isRowInBusinessScope(scope, existing)) {
      throw ApiError.forbidden("Akun di luar scope");
    }

    const { count } = await db
      .from("chart_of_accounts", "accounting")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", id)
      .is("deleted_at", null);

    if (count && count > 0) {
      throw ApiError.badRequest(
        `Tidak dapat dihapus — masih ada ${count} akun anak`
      );
    }

    const { error } = await db
      .from("chart_of_accounts", "accounting")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        is_active: false,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    await recomputePostableChain(existing.parent_id as string | null);

    return NextResponse.json({ message: "Akun berhasil dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/coa] DELETE", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
