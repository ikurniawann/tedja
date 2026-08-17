// EPIC-039 Fase E — detail & transisi status pesanan toko online.
// Transisi yang diizinkan: paid→packing, shipped→completed, dan cancel
// (pending/paid/packing). Shipped diproses lewat endpoint /shipment.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query, queryOne } from '@/lib/db';
import {
  releaseOrderReservations,
  restoreCommittedReservations,
} from '@/lib/shop/storefront-server';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  packing: ['paid'],
  completed: ['shipped'],
  cancelled: ['pending', 'paid', 'packing'],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const order = await queryOne(
      `SELECT o.*, s.id AS shipment_id, s.provider AS shipment_provider,
              s.status AS shipment_status, s.provider_order_id,
              s.tracking_history
       FROM shop.orders o
       LEFT JOIN shop.shipments s
         ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
       WHERE o.id = $1::uuid`,
      [id]
    );
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const items = await query(
      `SELECT product_name, sku_name, sku_code, quantity, unit_price, total, weight_gram
       FROM shop.order_items WHERE order_id = $1::uuid ORDER BY product_name`,
      [id]
    );

    return NextResponse.json({ success: true, data: { ...order, items } });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[shop] order detail error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat order' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const body = (await request.json()) as { status?: string; note?: string };
    const nextStatus = String(body.status || '').trim();
    const allowedFrom = ALLOWED_TRANSITIONS[nextStatus];
    if (!allowedFrom) {
      return NextResponse.json(
        { success: false, error: 'Transisi status tidak dikenal' },
        { status: 400 }
      );
    }

    const updated = await queryOne<{ id: string; status: string; prev_status: string }>(
      `UPDATE shop.orders o
       SET status = $2, updated_at = now(),
           notes = CASE WHEN $3::text IS NOT NULL
                        THEN COALESCE(o.notes || E'\n', '') || $3::text
                        ELSE o.notes END
       FROM (SELECT status AS prev_status FROM shop.orders WHERE id = $1::uuid) prev
       WHERE o.id = $1::uuid AND o.status = ANY($4::text[])
       RETURNING o.id, o.status, prev.prev_status`,
      [id, nextStatus, body.note?.trim() || null, allowedFrom]
    );

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Status order sudah berubah — muat ulang' },
        { status: 409 }
      );
    }

    if (nextStatus === 'cancelled') {
      // Pending: reservasi held; paid/packing: committed — dua-duanya
      // dikembalikan. Refund uang = MANUAL via dashboard Xendit (owner).
      if (updated.prev_status === 'pending') {
        await releaseOrderReservations(id);
      } else {
        await restoreCommittedReservations(id);
        await query(
          `UPDATE shop.shipments SET status='cancelled', updated_at=now()
           WHERE order_id = $1::uuid AND status NOT IN ('failed','cancelled')`,
          [id]
        ).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[shop] order transition error:', error);
    return NextResponse.json({ success: false, error: 'Gagal mengubah status' }, { status: 500 });
  }
}
