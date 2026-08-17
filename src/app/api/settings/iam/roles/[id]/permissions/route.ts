import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getIamRoleFromDb,
  listRolePermissionsMatrixFromDb,
  replaceIamRolePermissionsInDb,
} from "@/lib/iam/role-repository";
import { mapRoleDetail } from "@/lib/iam/role-mapper";

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
    return NextResponse.json({
      roleId: id,
      permissions: mapRoleDetail(row, permissions).permissions,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/roles/:id/permissions] GET failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireIamMenuPrefix(IAM.settingsRoles);
    const { id } = await context.params;
    const body = await request.json();

    const row = await getIamRoleFromDb(id);
    if (!row) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const normalized = permissions
      .filter(
        (item: { menuId?: string; isGranted?: boolean }) =>
          item.menuId && item.isGranted !== false
      )
      .map((item: { menuId: string; grantedActions?: string[] }) => ({
        menuId: item.menuId,
        grantedActions: Array.isArray(item.grantedActions) ? item.grantedActions : ["read"],
      }));

    await replaceIamRolePermissionsInDb(id, normalized, user.id);

    const matrix = await listRolePermissionsMatrixFromDb(id);
    return NextResponse.json({
      roleId: id,
      permissions: mapRoleDetail(row, matrix).permissions,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[iam/roles/:id/permissions] PUT failed:", error);
    return NextResponse.json({ error: apiErrorMessage(error) }, { status: 500 });
  }
}
