import { NextRequest, NextResponse } from "next/server";
import { ApiError, validateBody, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  createUserEmployee,
  listUserEmployees,
} from "@/lib/users/user-service";
import { createUserEmployeeSchema } from "@/lib/users/schemas";

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.settingsUsers);

    const searchParams = request.nextUrl.searchParams;
    const isAccessApp = searchParams.get("is_access_app");
    const isActive = searchParams.get("is_active");

    const result = await listUserEmployees({
      search: searchParams.get("search") ?? undefined,
      departmentId: searchParams.get("department_id") ?? undefined,
      employmentStatus: searchParams.get("employment_status") ?? undefined,
      isActive: isActive === null ? undefined : isActive === "true",
      isAccessApp: isAccessApp === null ? undefined : isAccessApp === "true",
      role: searchParams.get("role") ?? undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || "20", 10),
      sortBy: searchParams.get("sort_by") ?? "full_name",
      sortOrder: (searchParams.get("sort_order") as "asc" | "desc") ?? "asc",
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[api/users] GET failed:", error);
    return NextResponse.json({ error: "Failed to load employees" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireIamMenuPrefix(IAM.settingsUsers);
    const body = await validateBody(request, createUserEmployeeSchema);
    const data = await createUserEmployee(actor.id, body);

    return NextResponse.json(
      { data, message: "Employee created successfully" },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Failed to create employee";
    console.error("[api/users] POST failed:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
