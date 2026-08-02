// EPIC-039 Fase F — daftar akun marketplace + ubah buffer/putuskan koneksi.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole, ApiError } from '@/lib/api/auth';
import { query, queryOne } from '@/lib/db';

export async function GET() {
  try {
    await requireApiRole(['super_admin', 'admin']);
    const rows = await query(
      `SELECT a.id, a.channel_code, a.shop_id, a.shop_name, a.status,
              a.stock_buffer, a.last_pull_at, a.token_expires_at,
              (SELECT COUNT(*) FROM shop.marketplace_links l WHERE l.account_id = a.id) AS link_count
       FROM shop.marketplace_accounts a
       ORDER BY a.created_at`
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[marketplace] accounts error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat akun' }, { status: 500 });
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  stock_buffer: z.number().int().min(0).max(10000).optional(),
  status: z.enum(['disconnected']).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    await requireApiRole(['super_admin', 'admin']);
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Payload tidak valid' }, { status: 400 });
    }
    const { id, stock_buffer, status } = parsed.data;
    const updated = await queryOne(
      `UPDATE shop.marketplace_accounts
       SET stock_buffer = COALESCE($2, stock_buffer),
           status = COALESCE($3, status),
           access_token = CASE WHEN $3 = 'disconnected' THEN NULL ELSE access_token END,
           updated_at = now()
       WHERE id = $1::uuid
       RETURNING id, status, stock_buffer`,
      [id, stock_buffer ?? null, status ?? null]
    );
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Akun tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[marketplace] account patch error:', error);
    return NextResponse.json({ success: false, error: 'Gagal menyimpan akun' }, { status: 500 });
  }
}
