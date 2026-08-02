// EPIC-039 Fase E — buat pengiriman utk order paid/packing.
// Dua mode:
//   * mode 'provider' : Biteship createShipment (origin dari settings) —
//                       waybill bisa menyusul via webhook biteship.
//   * mode 'manual'   : resi diinput back-office (RajaOngkir/kurir apa pun).
// Resi diketahui → order 'shipped' + WA resi ke pembeli (best-effort).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiRole, ApiError } from '@/lib/api/auth';
import { query, queryOne } from '@/lib/db';
import { createPgClient } from '@/lib/pg/create-client';
import {
  getOrCreateShippingSettings,
  resolveOriginId,
  resolveShippingProvider,
  ShippingProviderError,
} from '@/lib/shop/shipping';
import { sendShopOrderShippedWa } from '@/lib/shop/shop-wa';

const bodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('provider') }),
  z.object({
    mode: z.literal('manual'),
    waybill: z.string().trim().min(6).max(60),
    courier_code: z.string().trim().max(30).optional(),
  }),
]);

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  access_token: string;
  customer_name: string;
  customer_phone: string;
  shipping_address: string;
  shipping_area_id: string | null;
  shipping_postal_code: string | null;
  courier_code: string | null;
  courier_service: string | null;
  total: string;
};

async function markShipped(order: OrderRow, waybill: string) {
  await query(
    `UPDATE shop.orders SET status='shipped', waybill=$2, updated_at=now()
     WHERE id = $1::uuid AND status IN ('paid','packing')`,
    [order.id, waybill]
  );
  void sendShopOrderShippedWa({
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    total: Number(order.total) || 0,
    accessToken: order.access_token,
    waybill,
    courierLabel: [order.courier_code, order.courier_service].filter(Boolean).join(' '),
  }).catch((err) => console.error(`[shop] WA resi gagal: ${order.order_number}:`, err));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireApiRole(['super_admin', 'admin']);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Payload tidak valid' }, { status: 400 });
    }

    const order = await queryOne<OrderRow>(
      `SELECT id, order_number, status, access_token, customer_name,
              customer_phone, shipping_address, shipping_area_id,
              shipping_postal_code, courier_code, courier_service, total
       FROM shop.orders WHERE id = $1::uuid`,
      [id]
    );
    if (!order) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (!['paid', 'packing'].includes(order.status)) {
      return NextResponse.json(
        { success: false, error: 'Pengiriman hanya untuk order yang sudah dibayar' },
        { status: 400 }
      );
    }

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM shop.shipments
       WHERE order_id = $1::uuid AND status NOT IN ('failed','cancelled')`,
      [id]
    );
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Order sudah punya pengiriman aktif' },
        { status: 409 }
      );
    }

    if (parsed.data.mode === 'manual') {
      const waybill = parsed.data.waybill;
      await query(
        `INSERT INTO shop.shipments (order_id, provider, courier_code, courier_service, waybill, status, created_by)
         VALUES ($1::uuid, 'manual', $2, $3, $4, 'in_transit', $5::uuid)`,
        [id, parsed.data.courier_code || order.courier_code, order.courier_service, waybill, user.id]
      );
      await markShipped(order, waybill);
      return NextResponse.json({ success: true, data: { waybill } }, { status: 201 });
    }

    // mode 'provider' — Biteship
    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const provider = resolveShippingProvider(settings.provider);
    if (!provider.capabilities.createShipment) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Provider aktif tidak mendukung pembuatan pengiriman — buat di aplikasi kurir lalu input resi manual',
        },
        { status: 400 }
      );
    }

    const originId = resolveOriginId(settings);
    if (!originId || !order.shipping_area_id) {
      return NextResponse.json(
        { success: false, error: 'Origin/tujuan tidak lengkap untuk pengiriman otomatis' },
        { status: 400 }
      );
    }

    const items = await query<{
      product_name: string;
      sku_name: string | null;
      quantity: string;
      unit_price: string;
      weight_gram: string | null;
    }>(
      `SELECT product_name, sku_name, quantity, unit_price, weight_gram
       FROM shop.order_items WHERE order_id = $1::uuid`,
      [id]
    );

    const shipment = await provider.createShipment({
      originId,
      originContactName: settings.origin_contact_name || 'Toko',
      originContactPhone: settings.origin_contact_phone || '-',
      originAddress: settings.origin_address || '-',
      destination: {
        areaId: order.shipping_area_id,
        contactName: order.customer_name,
        contactPhone: order.customer_phone,
        address: order.shipping_address,
        postalCode: order.shipping_postal_code,
      },
      courierCode: order.courier_code || 'jne',
      serviceCode: order.courier_service || 'reg',
      items: items.map((item) => ({
        name: item.sku_name ? `${item.product_name} ${item.sku_name}` : item.product_name,
        value: Number(item.unit_price) || 0,
        weightGram: Number(item.weight_gram) || 1000,
        quantity: Number(item.quantity) || 1,
      })),
      referenceId: order.order_number,
    });

    await query(
      `INSERT INTO shop.shipments (
         order_id, provider, courier_code, courier_service,
         provider_order_id, waybill, price, status, created_by
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'pickup', $8::uuid)`,
      [
        id,
        provider.name,
        order.courier_code,
        order.courier_service,
        shipment.providerOrderId,
        shipment.waybill,
        shipment.price,
        user.id,
      ]
    );

    if (shipment.waybill) {
      await markShipped(order, shipment.waybill);
    } else {
      // Waybill menyusul via webhook biteship — status order tetap packing
      await query(
        `UPDATE shop.orders SET status='packing', updated_at=now()
         WHERE id = $1::uuid AND status = 'paid'`,
        [id]
      );
    }

    return NextResponse.json(
      { success: true, data: { provider_order_id: shipment.providerOrderId, waybill: shipment.waybill } },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[shop] create shipment error:', error);
    return NextResponse.json({ success: false, error: 'Gagal membuat pengiriman' }, { status: 500 });
  }
}
