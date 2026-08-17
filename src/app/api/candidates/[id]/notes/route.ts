import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from "@/lib/db";

/**
 * Catatan internal HR per kandidat (timeline, append-only).
 * GET  /api/candidates/[id]/notes — daftar catatan terbaru dulu.
 * POST /api/candidates/[id]/notes — tambah catatan; penulis direkam dari session.
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ALLOWED_ROLES = ["super_admin", "admin", "hrd", "hiring_manager"] as const;

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;
    const rows = await query(
      `SELECT id, candidate_id, content, created_by, created_by_name, created_at
         FROM recruitment.candidate_notes
        WHERE candidate_id = $1
        ORDER BY created_at DESC`,
      [id]
    );
    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-notes] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireIamMenuPrefix(IAM.hrisRecruitment);
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ error: "Catatan tidak boleh kosong" }, { status: 400 });
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: "Catatan maksimal 2000 karakter" }, { status: 400 });
    }

    const candidate = await queryOne<{ id: string }>(
      "SELECT id FROM recruitment.candidates WHERE id = $1",
      [id]
    );
    if (!candidate) {
      return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
    }

    const rows = await query(
      `INSERT INTO recruitment.candidate_notes
         (candidate_id, content, created_by, created_by_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, candidate_id, content, created_by, created_by_name, created_at`,
      [id, content, user.id, user.full_name]
    );

    await query(
      `INSERT INTO recruitment.candidate_activities
         (candidate_id, activity_type, description, created_by, created_by_name)
       VALUES ($1, 'note_added', 'Catatan internal ditambahkan', $2, $3)`,
      [id, user.id, user.full_name]
    );

    return NextResponse.json({ data: rows[0], message: "Catatan tersimpan" }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[candidate-notes] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
