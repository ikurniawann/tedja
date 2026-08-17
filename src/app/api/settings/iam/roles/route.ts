import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { filterRoleRows, mapRoleItem } from "@/lib/iam/role-mapper";
import { createIamRoleInDb, listIamRolesFromDb } from "@/lib/iam/role-repository";

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: string }).message);
  }
  return "Internal server error";
}

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsRoles);

    const { searchParams } = request.nextUrl;
    const search = searchParams.get("search") ?? undefined;
    const status = searchParams.get("status") ?? undefined;

    const rows = await listIamRolesFromDb();
    const mapped = rows.map(mapRoleItem);
    const filtered = filterRoleRows(mapped, { search, status });

    return NextResponse.json({
      data: filtered,
      total: filtered.length,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/roles] GET failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsRoles);
    const body = await request.json();

    if (!body.code?.trim() || !body.name?.trim()) {
      return NextResponse.json({ error: "Code and name are required" }, { status: 400 });
    }

    const id = await createIamRoleInDb({
      code: String(body.code).trim().toLowerCase(),
      name: String(body.name).trim(),
      description: body.description?.trim() || null,
      isActive: body.isActive ?? true,
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/roles] POST failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}
