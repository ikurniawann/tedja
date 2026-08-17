import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  createBusinessEntity,
  fetchBusinessTree,
  type BusinessEntityType,
} from "@/lib/configuration/business-repository";

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Internal server error";
}

const VALID_TYPES: BusinessEntityType[] = ["holding", "company", "branch", "warehouse"];

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const tree = await fetchBusinessTree();
    return NextResponse.json({ data: tree });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/business] GET failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsBusiness);
    const body = await request.json();
    const type = body.type as BusinessEntityType;

    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: "Tipe entitas tidak valid" }, { status: 400 });
    }

    const result = await createBusinessEntity(type, {
      name: body.name,
      code: body.code,
      parentId: body.parentId,
      is_active: body.is_active,
    });

    const tree = await fetchBusinessTree();
    return NextResponse.json({ data: result, tree }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[settings/business] POST failed:", error);
    const message = apiErrorMessage(error);
    const status = message.includes("wajib") || message.includes("valid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
