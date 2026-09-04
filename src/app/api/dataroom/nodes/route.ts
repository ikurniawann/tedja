import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { DATAROOM_MAX_FILE_BYTES, DATAROOM_QUOTA_BYTES } from "@/lib/dataroom/config";
import { createFolder, getAncestors, getNode, listChildren, usedBytes } from "@/lib/dataroom/nodes";
import { getDataroomPermissions } from "@/lib/dataroom/api";

/**
 * GET /api/dataroom/nodes?parent=<id>  — isi folder (root bila kosong),
 * jejak breadcrumb, pemakaian kuota, dan hak aksi user.
 * POST /api/dataroom/nodes { name, parent_id } — folder baru.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.dataroom);
    const parentId = request.nextUrl.searchParams.get("parent") || null;
    let parent = null;
    if (parentId) {
      parent = await getNode(parentId);
      if (!parent || parent.kind !== "folder") throw ApiError.notFound("Folder tidak ditemukan");
    }
    const [items, ancestors, used, permissions] = await Promise.all([
      listChildren(parentId),
      parentId ? getAncestors(parentId) : Promise.resolve([]),
      usedBytes(),
      getDataroomPermissions(user),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        parent, items, ancestors,
        usage: { used, quota: DATAROOM_QUOTA_BYTES, max_file: DATAROOM_MAX_FILE_BYTES },
        permissions,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] nodes GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parent_id: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireIamAction(IAM.dataroom, "create");
    const body = await validateBody(request, createSchema);
    const parentId = body.parent_id ?? null;
    if (parentId) {
      const parent = await getNode(parentId);
      if (!parent || parent.kind !== "folder") throw ApiError.notFound("Folder induk tidak ditemukan");
    }
    const node = await createFolder({ parentId, name: body.name, userId: user.id, userName: user.full_name });
    return NextResponse.json({ success: true, data: node }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] nodes POST:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
