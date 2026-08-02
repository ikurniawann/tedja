// EPIC-039 Fase C — cek tarif kurir dari origin toko (settings) ke tujuan.
// Dipakai panel uji di settings admin dan checkout storefront (Fase D).

import { NextRequest, NextResponse } from 'next/server';
import { getPosSession } from '@/lib/api/auth';
import { createPgClient } from '@/lib/pg/create-client';
import {
  getOrCreateShippingSettings,
  parseCourierList,
  resolveOriginId,
  resolveShippingProvider,
  ShippingProviderError,
} from '@/lib/shop/shipping';

type RatesBody = {
  destination_id?: string;
  destination_postal_code?: string | null;
  weight_gram?: number | string;
  item_value?: number | string;
};

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RatesBody;
    const destinationId = String(body.destination_id || '').trim();
    const weightGram = Number(body.weight_gram);
    if (!destinationId) {
      return NextResponse.json({ success: false, error: 'Tujuan wajib dipilih' }, { status: 400 });
    }
    if (!Number.isFinite(weightGram) || weightGram <= 0) {
      return NextResponse.json(
        { success: false, error: 'Berat (gram) wajib angka > 0 — isi berat produk di master' },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const originId = resolveOriginId(settings);
    if (!originId) {
      return NextResponse.json(
        { success: false, error: 'Alamat origin toko belum diatur di Settings → Pengiriman' },
        { status: 400 }
      );
    }

    const provider = resolveShippingProvider(settings.provider);
    const quotes = await provider.getRates({
      originId,
      originPostalCode: settings.origin_postal_code,
      destinationId,
      destinationPostalCode: body.destination_postal_code ?? null,
      weightGram,
      itemValue: Number(body.item_value) || 0,
      couriers: parseCourierList(settings.couriers),
    });

    const markup = Number(settings.markup_amount) || 0;
    return NextResponse.json({
      success: true,
      data: quotes
        .filter((quote) => quote.price > 0)
        .map((quote) => ({
          ...quote,
          markup,
          total_price: quote.price + markup,
        })),
      meta: { provider: provider.name, markup },
    });
  } catch (error: unknown) {
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('Error fetching shipping rates:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gagal cek tarif' },
      { status: 500 }
    );
  }
}
