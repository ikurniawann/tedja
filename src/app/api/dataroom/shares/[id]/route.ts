import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamAction, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getShareById, listShareLogs, revokeShare } from "@/lib/dataroom/shares";

/**
 * GET    /api/dataroom/shares/[id] — log akses link.
 * DELETE /api/dataroom/shares/[id] — cabut link (penerima langsung ditolak).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireIamMenuPrefix(IAM.dataroom);
    const { id } = await params;
    const share = await getShareById(id);
    if (!share) throw ApiError.notFound("Link tidak ditemukan");
    return NextResponse.json({ success: true, data: { logs: await listShareLogs(id) } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] share GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireIamAction(IAM.dataroom, "update");
    const { id } = await params;
    const share = await getShareById(id);
    if (!share) throw ApiError.notFound("Link tidak ditemukan");
    await revokeShare(id);
    return NextResponse.json({ success: true, data: { revoked: id } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] share DELETE:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
