import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole, validateBody } from "@/lib/api/auth";
import {
  getUserEmployeeById,
  updateUserEmployee,
} from "@/lib/users/user-service";
import { updateUserEmployeeSchema } from "@/lib/users/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireApiRole(["super_admin", "admin", "hrd"]);
    const { id } = await params;
    const data = await getUserEmployeeById(id);

    if (!data) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[api/users/:id] GET failed:", error);
    return NextResponse.json({ error: "Failed to load employee" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const actor = await requireApiRole(["super_admin", "admin", "hrd"]);
    const { id } = await params;
    const body = await validateBody(request, updateUserEmployeeSchema);
    const data = await updateUserEmployee(actor.id, id, body);

    return NextResponse.json({ data, message: "Employee updated successfully" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to update employee";
    console.error("[api/users/:id] PUT failed:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
