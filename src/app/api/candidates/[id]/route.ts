import { createServerPgClient } from "@/lib/pg/create-client";
import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { deletePrivateFolder } from "@/lib/storage-private";

// GET /api/candidates/[id]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = await createServerPgClient();
  const { id } = await params;

  const { data, error } = await db
    .from("candidates")
    .select("*, brands(name), positions(title)")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json({ data });
}

// PUT /api/candidates/[id]
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = await createServerPgClient();
  const { id } = await params;
  const body = await request.json();

  const { data, error } = await db
    .from("candidates")
    .update({
      full_name: body.full_name,
      email: body.email,
      phone: body.phone,
      domicile: body.domicile,
      source: body.source,
      position_id: body.position_id,
      brand_id: body.brand_id,
      status: body.status,
      notes: body.notes,
      cv_url: body.cv_url,
      photo_url: body.photo_url,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data });
}

// DELETE /api/candidates/[id]
// Destruktif & ireversibel (termasuk purge bukti psikotes di storage) —
// wajib role eksplisit; penghapus dicatat di log server karena
// candidate_activities ikut ter-CASCADE.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const db = await createServerPgClient();
    const { id } = await params;

    // retensi psikotes: baris DB terhapus via CASCADE, tapi file di
    // storage/private (gambar tes + snapshot proctoring) harus dibersihkan manual
    const { data: psikotesSessions } = await db
      .from("psikotes_sessions")
      .select("id")
      .eq("candidate_id", id);

    const { error } = await db.from("candidates").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const sessions = (psikotesSessions as { id: string }[] | null) ?? [];
    if (sessions.length > 0) {
      console.info(
        `[candidates] DELETE ${id} oleh ${user.full_name} (${user.id}) — purge ${sessions.length} folder bukti psikotes`
      );
    }
    for (const session of sessions) {
      await deletePrivateFolder(`psikotes/${session.id}`);
    }

    return NextResponse.json({ message: "Kandidat dihapus" });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidates] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
