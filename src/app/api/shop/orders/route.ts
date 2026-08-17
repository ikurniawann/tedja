// EPIC-039 Fase E — daftar pesanan toko online (back-office).

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query } from '@/lib/db';
import { releaseExpiredReservations } from '@/lib/shop/storefront-server';

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    await releaseExpiredReservations();

    const status = String(request.nextUrl.searchParams.get('status') || '').trim();
    const search = String(request.nextUrl.searchParams.get('search') || '').trim();
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 100));

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(o.order_number ILIKE $${params.length} OR o.customer_name ILIKE $${params.length} OR o.customer_phone ILIKE $${params.length})`
      );
    }
    params.push(limit);

    const rows = await query(
      `SELECT o.id, o.order_number, o.status, o.customer_name, o.customer_phone,
              o.shipping_area_label, o.courier_code, o.courier_service,
              o.subtotal, o.shipping_cost, o.total, o.waybill, o.paid_at,
              o.created_at, o.customer_id,
              (SELECT COUNT(*) FROM shop.order_items i WHERE i.order_id = o.id) AS item_count,
              s.status AS shipment_status, s.provider AS shipment_provider
       FROM shop.orders o
       LEFT JOIN shop.shipments s
         ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY o.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[shop] orders list error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat pesanan' }, { status: 500 });
  }
}
