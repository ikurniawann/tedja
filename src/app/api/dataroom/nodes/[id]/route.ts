import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamAction, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { deleteNodeCascade, getNode, isSameOrDescendant, moveNode, renameNode } from "@/lib/dataroom/nodes";
import { deleteDataroomFiles } from "@/lib/dataroom/storage";

/**
 * PATCH /api/dataroom/nodes/[id] { name? , parent_id? } — ganti nama / pindah.
 * DELETE /api/dataroom/nodes/[id] — hapus (folder: beserta seluruh isinya).
 */
const patchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireIamAction(IAM.dataroom, "update");
    const { id } = await params;
    const body = await validateBody(request, patchSchema);
    let node = await getNode(id);
    if (!node) throw ApiError.notFound("Item tidak ditemukan");

    if (body.parent_id !== undefined) {
      const target = body.parent_id;
      if (target) {
        const folder = await getNode(target);
        if (!folder || folder.kind !== "folder") throw ApiError.notFound("Folder tujuan tidak ditemukan");
        if (node.kind === "folder" && (await isSameOrDescendant(target, node.id))) {
          throw ApiError.badRequest("Folder tidak bisa dipindahkan ke dalam dirinya sendiri");
        }
      }
      if (target !== node.parent_id) node = (await moveNode(id, target)) ?? node;
    }
    if (body.name !== undefined && body.name !== node.name) {
      node = (await renameNode(id, body.name)) ?? node;
    }
    return NextResponse.json({ success: true, data: node });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] node PATCH:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireIamAction(IAM.dataroom, "delete");
    const { id } = await params;
    const node = await getNode(id);
    if (!node) throw ApiError.notFound("Item tidak ditemukan");
    const paths = await deleteNodeCascade(id);
    await deleteDataroomFiles(paths);
    return NextResponse.json({ success: true, data: { deleted: id, files_removed: paths.length } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] node DELETE:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
