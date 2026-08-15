// EPIC-039 Fase C — cari area/kecamatan tujuan sesuai provider aktif
// (Biteship maps/areas; RajaOngkir domestic-destination).

import { NextRequest, NextResponse } from 'next/server';
import { getPosSession } from '@/lib/api/auth';
import { createPgClient } from '@/lib/pg/create-client';
import {
  getOrCreateShippingSettings,
  resolveShippingProvider,
  ShippingProviderError,
} from '@/lib/shop/shipping';

export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const query = String(request.nextUrl.searchParams.get('q') || '').trim();
    if (query.length < 3) {
      return NextResponse.json({ success: true, data: [] });
    }

    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const provider = resolveShippingProvider(settings.provider);
    const areas = await provider.searchAreas(query);

    return NextResponse.json({
      success: true,
      data: areas,
      meta: { provider: provider.name },
    });
  } catch (error: unknown) {
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('Error searching shipping areas:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gagal mencari area' },
      { status: 500 }
    );
  }
}
