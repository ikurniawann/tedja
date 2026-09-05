import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { listAllFolders } from "@/lib/dataroom/nodes";
import { createAccessResolver, resolveActor } from "@/lib/dataroom/access";

/** GET /api/dataroom/tree — semua folder (untuk dialog "Pindahkan ke"). */
export async function GET() {
  try {
    const user = await requireIamMenuPrefix(IAM.dataroom);
    const access = await createAccessResolver(await resolveActor(user));
    const folders = (await listAllFolders()).filter((f) => access.allowsFolder(f.id));
    return NextResponse.json({ success: true, data: folders });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] tree:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
