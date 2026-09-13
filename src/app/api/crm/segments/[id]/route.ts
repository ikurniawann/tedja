import { NextRequest, NextResponse } from "next/server";
import { noContentResponse, successResponse } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { segmentSchema } from "@/lib/crm/segments";
import { loadAccessibleSegment, requireSegmentUser } from "@/lib/crm/segments-server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const { id } = await params;
  const row = await loadAccessibleSegment(id, scope);
  if (!row) return NextResponse.json({ success: false, error: "Segmen tidak ditemukan" }, { status: 404 });
  return successResponse(row);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const { id } = await params;
  if (!(await loadAccessibleSegment(id, scope))) {
    return NextResponse.json({ success: false, error: "Segmen tidak ditemukan" }, { status: 404 });
  }
  const parsed = segmentSchema.partial().safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;
  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (col: string, v: unknown, cast = "") => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (b.name !== undefined) push("name", b.name);
  if (b.description !== undefined) push("description", b.description ?? null);
  if (b.is_active !== undefined) push("is_active", b.is_active);
  if (b.definition !== undefined) {
    push("definition", JSON.stringify(b.definition), "::jsonb");
    push("source", b.definition.source);
    // Definisi berubah → jumlah tersimpan tidak lagi berlaku.
    sets.push("last_count = NULL", "last_counted_at = NULL");
  }
  if (values.length === 0) return NextResponse.json({ success: false, error: "Tidak ada field yang diubah" }, { status: 400 });
  values.push(id);
  const row = await queryOne(
    `UPDATE crm.crm_segments SET ${sets.join(", ")} WHERE id = $${values.length} AND deleted_at IS NULL
     RETURNING id, name, source, is_active`,
    values
  );
  return successResponse(row, "Segmen diperbarui");
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, scope } = await requireSegmentUser();
  if (error) return error;
  const { id } = await params;
  if (!(await loadAccessibleSegment(id, scope))) {
    return NextResponse.json({ success: false, error: "Segmen tidak ditemukan" }, { status: 404 });
  }
  const used = await queryOne<{ id: string }>(
    `SELECT id FROM crm.crm_campaigns WHERE segment_id = $1 AND status IN ('draft', 'sending', 'paused') LIMIT 1`,
    [id]
  );
  if (used) {
    return NextResponse.json({ success: false, error: "Segmen masih dipakai kampanye yang berjalan" }, { status: 409 });
  }
  await query(`UPDATE crm.crm_segments SET deleted_at = now(), is_active = false WHERE id = $1`, [id]);
  return noContentResponse();
}
