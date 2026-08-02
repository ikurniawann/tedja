// EPIC-039 Fase D — status order publik by access_token (pola booking status).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`shop-order-status:${ip}`, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { token } = await params;
    if (!z.string().uuid().safeParse(token).success) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const order = await queryOne<{
      id: string;
      order_number: string;
      status: string;
      customer_name: string;
      shipping_area_label: string | null;
      shipping_address: string;
      courier_code: string | null;
      courier_service: string | null;
      subtotal: string;
      shipping_cost: string;
      total: string;
      xendit_invoice_url: string | null;
      waybill: string | null;
      paid_at: string | null;
      created_at: string;
    }>(
      `SELECT id, order_number, status, customer_name, shipping_area_label,
              shipping_address, courier_code, courier_service, subtotal,
              shipping_cost, total, xendit_invoice_url, waybill, paid_at, created_at
       FROM shop.orders WHERE access_token = $1::uuid`,
      [token]
    );
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const items = await query<{
      product_name: string;
      sku_name: string | null;
      quantity: string;
      unit_price: string;
      total: string;
    }>(
      `SELECT product_name, sku_name, quantity, unit_price, total
       FROM shop.order_items WHERE order_id = $1::uuid ORDER BY product_name`,
      [order.id]
    );

    return NextResponse.json({
      success: true,
      data: {
        order_number: order.order_number,
        status: order.status,
        customer_name: order.customer_name,
        shipping_area_label: order.shipping_area_label,
        shipping_address: order.shipping_address,
        courier: [order.courier_code, order.courier_service].filter(Boolean).join(' — '),
        subtotal: Number(order.subtotal),
        shipping_cost: Number(order.shipping_cost),
        total: Number(order.total),
        invoice_url: order.status === 'pending' ? order.xendit_invoice_url : null,
        waybill: order.waybill,
        paid_at: order.paid_at,
        created_at: order.created_at,
        items: items.map((item) => ({
          name: item.sku_name ? `${item.product_name} — ${item.sku_name}` : item.product_name,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          total: Number(item.total),
        })),
      },
    });
  } catch (error: unknown) {
    console.error('[shop] order status error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat order' }, { status: 500 });
  }
}
