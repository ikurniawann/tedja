import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ACCOUNTING_API_ROLES } from "@/lib/accounting/coa-types";

const SELECT =
  "id, code, name, normal_balance, sort_order, is_active, created_at, updated_at";

const payloadSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(100),
  normal_balance: z.enum(["DEBIT", "CREDIT"]),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const body = payloadSchema.parse(await request.json());
    const db = await createServerPgClient();

    const { data, error } = await db
      .from("account_types", "accounting")
      .update({
        code: body.code.trim().toUpperCase(),
        name: body.name.trim(),
        normal_balance: body.normal_balance,
        sort_order: body.sort_order ?? 0,
        is_active: body.is_active ?? true,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        throw ApiError.badRequest("Kode account type sudah digunakan");
      }
      throw error;
    }
    if (!data) throw ApiError.notFound("Account type tidak ditemukan");

    return NextResponse.json({
      data,
      message: "Account type berhasil diperbarui",
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Validasi gagal" },
        { status: 400 }
      );
    }
    console.error("[accounting/account-types] PUT", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const { id } = await params;
    const db = await createServerPgClient();

    const { count } = await db
      .from("chart_of_accounts", "accounting")
      .select("id", { count: "exact", head: true })
      .eq("account_type_id", id)
      .is("deleted_at", null);

    if (count && count > 0) {
      throw ApiError.badRequest(
        `Tidak dapat dihapus — masih dipakai ${count} akun COA`
      );
    }

    const { error } = await db
      .from("account_types", "accounting")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ message: "Account type berhasil dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/account-types] DELETE", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
