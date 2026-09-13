import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { segmentDefinitionSchema } from "@/lib/crm/segments";
import { previewSegment, requireSegmentUser } from "@/lib/crm/segments-server";

/** EPIC-050 T-5.1 — pratinjau definisi ad-hoc (jumlah + contoh anggota). */
export async function POST(request: NextRequest) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const parsed = segmentDefinitionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  return successResponse(await previewSegment(parsed.data, scope));
}
