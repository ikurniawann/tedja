import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { listDepartments } from "@/lib/dataroom/access";

/** GET /api/dataroom/departments — daftar departemen (untuk dialog atur akses). */
export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.dataroom);
    return NextResponse.json({ success: true, data: await listDepartments() });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] departments:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
