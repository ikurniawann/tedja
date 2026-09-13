import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { loadAccessibleSegment, parseStoredSegment, previewSegment, rememberSegmentCount, requireSegmentUser } from "@/lib/crm/segments-server";

/** Hitung ulang anggota segmen tersimpan dan simpan jumlahnya. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const { id } = await params;
  const row = await loadAccessibleSegment(id, scope);
  if (!row) return NextResponse.json({ success: false, error: "Segmen tidak ditemukan" }, { status: 404 });
  const result = await previewSegment(parseStoredSegment(row.source, row.definition), scope);
  await rememberSegmentCount(id, result.total);
  return successResponse(result, `${result.total} anggota`);
}
