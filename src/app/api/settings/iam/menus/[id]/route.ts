import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { mapMenuDetail } from "@/lib/iam/menu-mapper";
import {
  deleteIamMenuInDb,
  getIamMenuFromDb,
  updateIamMenuInDb,
} from "@/lib/iam/menu-repository";

type RouteContext = { params: Promise<{ id: string }> };

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: string }).message);
  }
  return "Internal server error";
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireIamMenuPrefix(IAM.settingsMenus);
    const { id } = await context.params;

    const row = await getIamMenuFromDb(id);
    if (!row) {
      return NextResponse.json({ error: "Menu not found" }, { status: 404 });
    }

    return NextResponse.json(mapMenuDetail(row));
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/menus/:id] GET failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireIamMenuPrefix(IAM.settingsMenus);
    const { id } = await context.params;
    const body = await request.json();

    const updated = await updateIamMenuInDb(id, body, user.id);
    if (!updated) {
      return NextResponse.json({ error: "Menu not found" }, { status: 404 });
    }

    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/menus/:id] PUT failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const user = await requireIamMenuPrefix(IAM.settingsMenus);
    const { id } = await context.params;

    const deleted = await deleteIamMenuInDb(id, user.id);
    if (!deleted) {
      return NextResponse.json({ error: "Menu not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/menus/:id] DELETE failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}
