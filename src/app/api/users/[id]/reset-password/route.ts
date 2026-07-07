import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";
import { createPgClient } from "@/lib/pg/create-client";
import { resetUserEmployeePassword } from "@/lib/users/user-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireApiRole(["super_admin", "admin"]);
    const { id } = await params;
    const db = createPgClient();

    const { data: employee, error } = await db
      .from("employees")
      .select("user_id, is_access_app")
      .eq("id", id)
      .single();

    if (error || !employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    if (!employee.is_access_app || !employee.user_id) {
      return NextResponse.json(
        { error: "This employee does not have app access" },
        { status: 400 }
      );
    }

    const result = await resetUserEmployeePassword(employee.user_id);

    return NextResponse.json({
      message: result.message,
      tempPassword: result.tempPassword,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to reset password";
    console.error("[api/users/:id/reset-password] failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
