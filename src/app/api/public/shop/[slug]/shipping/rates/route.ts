// EPIC-039 Fase D — cek tarif utk checkout publik. Berat dihitung SERVER
// dari isi keranjang (bukan dari klien) supaya ongkir tidak bisa dimanipulasi.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { createPgClient } from '@/lib/pg/create-client';
import {
  getOrCreateShippingSettings,
  parseCourierList,
  resolveOriginId,
  resolveShippingProvider,
  ShippingProviderError,
} from '@/lib/shop/shipping';
import { computeCartWeightAndValue, resolveStorefront } from '@/lib/shop/storefront-server';

const bodySchema = z.object({
  destination_id: z.string().min(1),
  destination_postal_code: z.string().nullish(),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().positive().max(999),
      })
    )
    .min(1)
    .max(50),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`shop-rates:${ip}`, { limit: 20, windowMs: 60_000 })) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { slug } = await params;
    if (!(await resolveStorefront(slug))) {
      return NextResponse.json({ success: false, error: 'Toko tidak ditemukan' }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Payload tidak valid' }, { status: 400 });
    }

    // Berat & nilai barang dihitung dari katalog server
    const { weightGram, itemValue } = await computeCartWeightAndValue(parsed.data.items);
    if (weightGram <= 0) {
      return NextResponse.json({ success: false, error: 'Keranjang tidak valid' }, { status: 400 });
    }

    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const originId = resolveOriginId(settings);
    if (!originId) {
      return NextResponse.json(
        { success: false, error: 'Toko belum mengatur alamat pengiriman' },
        { status: 503 }
      );
    }

    const provider = resolveShippingProvider(settings.provider);
    const quotes = await provider.getRates({
      originId,
      originPostalCode: settings.origin_postal_code,
      destinationId: parsed.data.destination_id,
      destinationPostalCode: parsed.data.destination_postal_code ?? null,
      weightGram,
      itemValue,
      couriers: parseCourierList(settings.couriers),
    });

    const markup = Number(settings.markup_amount) || 0;
    return NextResponse.json({
      success: true,
      data: quotes
        .filter((quote) => quote.price > 0)
        .map((quote) => ({ ...quote, total_price: quote.price + markup })),
      meta: { provider: provider.name, weight_gram: weightGram },
    });
  } catch (error: unknown) {
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[shop] public rates error:', error);
    return NextResponse.json({ success: false, error: 'Gagal cek ongkir' }, { status: 500 });
  }
}
