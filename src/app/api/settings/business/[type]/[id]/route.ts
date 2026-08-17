import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  deleteBusinessEntity,
  fetchBusinessTree,
  updateBusinessEntity,
  type BusinessEntityType,
} from "@/lib/configuration/business-repository";

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

const VALID_TYPES: BusinessEntityType[] = ["holding", "company", "branch", "warehouse"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const { type, id } = await params;

    if (!VALID_TYPES.includes(type as BusinessEntityType)) {
      return NextResponse.json({ error: "Tipe entitas tidak valid" }, { status: 400 });
    }

    const body = await request.json();
    await updateBusinessEntity(type as BusinessEntityType, id, {
      name: body.name,
      code: body.code,
      is_active: body.is_active,
    });

    const tree = await fetchBusinessTree();
    return NextResponse.json({ data: { id }, tree });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/business] PATCH failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const { type, id } = await params;

    if (!VALID_TYPES.includes(type as BusinessEntityType)) {
      return NextResponse.json({ error: "Tipe entitas tidak valid" }, { status: 400 });
    }

    await deleteBusinessEntity(type as BusinessEntityType, id);
    const tree = await fetchBusinessTree();
    return NextResponse.json({ data: { id }, tree });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/business] DELETE failed:", error);
    const message = apiErrorMessage(error);
    const status = message.includes("tidak dapat") || message.includes("tidak ditemukan") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
