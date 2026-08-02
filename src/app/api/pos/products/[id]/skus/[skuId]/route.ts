// EPIC-039 Fase B — ubah/hapus satu varian SKU.
// PATCH: edit field (termasuk koreksi stok & nonaktifkan); DELETE: hapus
// (riwayat order aman — FK pos_order_items.sku_id ON DELETE SET NULL).

import { NextRequest, NextResponse } from 'next/server';
import { getPosSession } from '@/lib/api/auth';
import { createPgClient } from '@/lib/pg/create-client';
import { normalizeSkuPayload, isUniqueViolation } from '@/lib/pos/merchandise-sku-payload';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; skuId: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id, skuId } = await params;
    const body = await request.json();
    const normalized = normalizeSkuPayload(body);
    if (!normalized.ok) {
      return NextResponse.json({ success: false, error: normalized.error }, { status: 400 });
    }
    if (Object.keys(normalized.columns).length === 0) {
      return NextResponse.json({ success: false, error: 'Tidak ada field yang diubah' }, { status: 400 });
    }

    const db = createPgClient();
    const { data, error } = await db
      .from('pos_product_skus')
      .update({ ...normalized.columns, updated_at: new Date().toISOString() })
      .eq('id', skuId)
      .eq('product_id', id)
      .select('*')
      .single();

    if (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { success: false, error: 'Kode SKU / barcode sudah dipakai varian lain' },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('Error updating product SKU:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; skuId: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id, skuId } = await params;
    const db = createPgClient();
    const { error } = await db
      .from('pos_product_skus')
      .delete()
      .eq('id', skuId)
      .eq('product_id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting product SKU:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
