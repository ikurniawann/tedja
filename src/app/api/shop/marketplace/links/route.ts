// EPIC-039 Fase F — mapping listing marketplace ↔ produk/SKU lokal.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const accountId = String(request.nextUrl.searchParams.get('account_id') || '');
    if (!z.string().uuid().safeParse(accountId).success) {
      return NextResponse.json({ success: false, error: 'account_id tidak valid' }, { status: 400 });
    }
    const rows = await query(
      `SELECT l.*, p.name AS product_name, s.name AS sku_name, s.sku AS sku_code
       FROM shop.marketplace_links l
       JOIN pos.pos_products p ON p.id = l.product_id
       LEFT JOIN pos.pos_product_skus s ON s.id = l.sku_id
       WHERE l.account_id = $1::uuid
       ORDER BY l.created_at DESC`,
      [accountId]
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[marketplace] links list error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat mapping' }, { status: 500 });
  }
}

const createSchema = z.object({
  account_id: z.string().uuid(),
  product_id: z.string().uuid(),
  sku_id: z.string().uuid().nullish(),
  marketplace_item_id: z.string().min(1),
  marketplace_model_id: z.string().nullish(),
  marketplace_item_name: z.string().nullish(),
});

export async function POST(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Payload tidak valid' }, { status: 400 });
    }
    const body = parsed.data;

    const product = await queryOne<{ id: string; product_kind: string }>(
      'SELECT id, product_kind FROM pos.pos_products WHERE id = $1::uuid',
      [body.product_id]
    );
    if (!product || product.product_kind !== 'merchandise') {
      return NextResponse.json(
        { success: false, error: 'Mapping hanya untuk produk merchandise' },
        { status: 400 }
      );
    }

    const inserted = await queryOne(
      `INSERT INTO shop.marketplace_links (
         account_id, product_id, sku_id, marketplace_item_id,
         marketplace_model_id, marketplace_item_name
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
       RETURNING *`,
      [
        body.account_id,
        body.product_id,
        body.sku_id ?? null,
        body.marketplace_item_id,
        body.marketplace_model_id ?? null,
        body.marketplace_item_name ?? null,
      ]
    );
    return NextResponse.json({ success: true, data: inserted }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    const message = error instanceof Error ? error.message : '';
    if (/duplicate key|unique/i.test(message)) {
      return NextResponse.json(
        { success: false, error: 'Listing/produk ini sudah dipetakan' },
        { status: 409 }
      );
    }
    console.error('[marketplace] link create error:', error);
    return NextResponse.json({ success: false, error: 'Gagal membuat mapping' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const id = String(request.nextUrl.searchParams.get('id') || '');
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ success: false, error: 'id tidak valid' }, { status: 400 });
    }
    await query('DELETE FROM shop.marketplace_links WHERE id = $1::uuid', [id]);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[marketplace] link delete error:', error);
    return NextResponse.json({ success: false, error: 'Gagal menghapus mapping' }, { status: 500 });
  }
}
