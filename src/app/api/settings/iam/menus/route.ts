import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { filterMenuRows, mapMenuItem } from "@/lib/iam/menu-mapper";
import { createIamMenuInDb, listIamMenusFromDb } from "@/lib/iam/menu-repository";

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: string }).message);
  }
  return "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsMenus);

    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const menuType = searchParams.get("menuType") ?? undefined;

    const rows = await listIamMenusFromDb();
    const mapped = rows.map(mapMenuItem);
    const filtered = filterMenuRows(mapped, { search, status, menuType });

    return NextResponse.json({
      data: filtered,
      total: filtered.length,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/menus] GET failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.settingsMenus);
    const body = await request.json();
    const id = await createIamMenuInDb(body, user.id);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/menus] POST failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}
