import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireIamMenuPrefix, validateBody } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { getDepartmentsForNodes, isDataroomAdminRole, setNodeDepartments } from "@/lib/dataroom/access";
import { getNode } from "@/lib/dataroom/nodes";

/**
 * GET /api/dataroom/nodes/[id]/access — departemen yang boleh membuka folder.
 * PUT /api/dataroom/nodes/[id]/access { department_ids: [] } — hanya super
 * admin; daftar kosong = terbuka untuk semua departemen.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireIamMenuPrefix(IAM.dataroom);
    const { id } = await params;
    const node = await getNode(id);
    if (!node || node.kind !== "folder") throw ApiError.notFound("Folder tidak ditemukan");
    const map = await getDepartmentsForNodes([id]);
    return NextResponse.json({ success: true, data: { node_id: id, departments: map.get(id) ?? [] } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] access GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

const putSchema = z.object({ department_ids: z.array(z.string().uuid()).max(200) });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireIamMenuPrefix(IAM.dataroom);
    if (!isDataroomAdminRole(user.role)) throw ApiError.forbidden("Hanya super admin yang bisa mengatur akses departemen");
    const { id } = await params;
    const node = await getNode(id);
    if (!node || node.kind !== "folder") throw ApiError.notFound("Folder tidak ditemukan");
    const body = await validateBody(request, putSchema);
    await setNodeDepartments(id, [...new Set(body.department_ids)], user.id);
    const map = await getDepartmentsForNodes([id]);
    return NextResponse.json({ success: true, data: { node_id: id, departments: map.get(id) ?? [] } });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[dataroom] access PUT:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
