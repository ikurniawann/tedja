// EPIC-039 Fase D — pencarian area tujuan utk checkout publik (rate-limited).

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { createPgClient } from '@/lib/pg/create-client';
import {
  getOrCreateShippingSettings,
  resolveShippingProvider,
  ShippingProviderError,
} from '@/lib/shop/shipping';
import { resolveStorefront } from '@/lib/shop/storefront-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`shop-areas:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { slug } = await params;
    if (!(await resolveStorefront(slug))) {
      return NextResponse.json({ success: false, error: 'Toko tidak ditemukan' }, { status: 404 });
    }

    const query = String(request.nextUrl.searchParams.get('q') || '').trim();
    if (query.length < 3) {
      return NextResponse.json({ success: true, data: [] });
    }

    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const provider = resolveShippingProvider(settings.provider);
    const areas = await provider.searchAreas(query);
    return NextResponse.json({ success: true, data: areas });
  } catch (error: unknown) {
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[shop] public areas error:', error);
    return NextResponse.json({ success: false, error: 'Gagal mencari area' }, { status: 500 });
  }
}
