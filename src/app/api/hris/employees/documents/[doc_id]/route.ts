// ============================================================
// API Route: Employee Document by ID
// DELETE: Remove document record
// PATCH: Update document metadata
//
// Keamanan (audit 2026-09-17): sebelumnya route ini menjalankan mutasi DB
// TANPA cek sesi/izin sama sekali — middleware hanya memastikan ada cookie,
// jadi cookie sampah pun bisa menghapus/mengubah dokumen karyawan. Kini:
//  - requireIamMenuPrefix(IAM.hrisKepegawaian): wajib sesi valid + hak menu.
//  - PATCH memakai allowlist field (Zod), bukan spread body mentah, supaya
//    kolom sensitif (is_verified, verified_by, uploaded_by, employee_id, dsb.)
//    tidak bisa dipaksa lewat body.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

interface RouteParams {
  params: Promise<{ doc_id: string }>;
}

// Hanya metadata yang memang boleh diubah manual. Verifikasi (is_verified/
// verified_by/verified_at) punya alurnya sendiri; jangan bisa dititipkan di sini.
const patchSchema = z
  .object({
    document_type: z.string().max(120).optional(),
    document_name: z.string().max(255).optional(),
    issue_date: z.string().optional().nullable(),
    expiry_date: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strip();

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const db = await createServerPgClient();
    const { doc_id } = await params;

    const { error } = await db
      .from('employee_documents')
      .delete()
      .eq('id', doc_id);

    if (error) {
      console.error('Error deleting document:', error);
      return NextResponse.json({ error: 'Gagal menghapus dokumen' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Dokumen berhasil dihapus' });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in document DELETE:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await requireIamMenuPrefix(IAM.hrisKepegawaian);
    const db = await createServerPgClient();
    const { doc_id } = await params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
    }

    const { data, error } = await db
      .from('employee_documents')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', doc_id)
      .select()
      .single();

    if (error) {
      console.error('Error updating document:', error);
      return NextResponse.json({ error: 'Gagal mengupdate dokumen' }, { status: 500 });
    }

    return NextResponse.json({ data, message: 'Dokumen berhasil diupdate' });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error in document PATCH:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
