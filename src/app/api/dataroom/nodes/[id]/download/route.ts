import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getNode } from "@/lib/dataroom/nodes";
import { serveNodeFile } from "@/lib/dataroom/api";

/** GET /api/dataroom/nodes/[id]/download?inline=1 — unduh / pratinjau (ber-auth). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireIamMenuPrefix(IAM.dataroom);
    const { id } = await params;
    const node = await getNode(id);
    if (!node || node.kind !== "file") throw ApiError.notFound("File tidak ditemukan");
    return serveNodeFile(node, { inline: request.nextUrl.searchParams.get("inline") === "1" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] download:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
