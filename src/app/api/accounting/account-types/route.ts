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

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : "Internal server error";
}

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.accounting);
    const db = await createServerPgClient();
    const { data, error } = await db
      .from("account_types", "accounting")
      .select(SELECT)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[accounting/account-types] GET", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.accounting);
    const body = payloadSchema.parse(await request.json());
    const db = await createServerPgClient();

    const code = body.code.trim().toUpperCase();
    const { data, error } = await db
      .from("account_types", "accounting")
      .insert({
        code,
        name: body.name.trim(),
        normal_balance: body.normal_balance,
        sort_order: body.sort_order ?? 0,
        is_active: body.is_active ?? true,
        created_by: user.id,
        updated_by: user.id,
      })
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        throw ApiError.badRequest("Kode account type sudah digunakan");
      }
      throw error;
    }

    return NextResponse.json(
      { data, message: "Account type berhasil ditambahkan" },
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
    console.error("[accounting/account-types] POST", error);
    return NextResponse.json({ error: errMsg(error) }, { status: 500 });
  }
}
