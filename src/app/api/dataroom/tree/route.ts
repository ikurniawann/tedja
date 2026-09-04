import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { listAllFolders } from "@/lib/dataroom/nodes";

/** GET /api/dataroom/tree — semua folder (untuk dialog "Pindahkan ke"). */
export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.dataroom);
    return NextResponse.json({ success: true, data: await listAllFolders() });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] tree:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
