import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { mapRoleDetail } from "@/lib/iam/role-mapper";
import {
  deleteIamRoleInDb,
  getIamRoleFromDb,
  listRolePermissionsMatrixFromDb,
  updateIamRoleInDb,
} from "@/lib/iam/role-repository";

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
    await requireIamMenuPrefix(IAM.settingsRoles);
    const { id } = await context.params;

    const row = await getIamRoleFromDb(id);
    if (!row) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const permissions = await listRolePermissionsMatrixFromDb(id);
    return NextResponse.json(mapRoleDetail(row, permissions));
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/roles/:id] GET failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    await requireIamMenuPrefix(IAM.settingsRoles);
    const { id } = await context.params;
    const body = await request.json();

    const existing = await getIamRoleFromDb(id);
    if (!existing) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    if (existing.is_system && body.code && body.code !== existing.code) {
      return NextResponse.json({ error: "System role code cannot be changed" }, { status: 400 });
    }

    const updated = await updateIamRoleInDb(id, {
      code: existing.is_system ? undefined : body.code?.trim()?.toLowerCase(),
      name: body.name?.trim(),
      description: body.description,
      isActive: body.isActive,
    });

    if (!updated) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/roles/:id] PUT failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireIamMenuPrefix(IAM.settingsRoles);
    const { id } = await context.params;

    const deleted = await deleteIamRoleInDb(id);
    if (!deleted) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/roles/:id] DELETE failed:", error);
    const message = apiErrorMessage(error);
    const status = message.includes("System roles") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
