// EPIC-039 Fase C — lacak resi via provider aktif (Biteship tracking API /
// RajaOngkir track/waybill). Dipakai manajemen pesanan (Fase E) & uji admin.

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
    const waybill = String(request.nextUrl.searchParams.get('waybill') || '').trim();
    const courier = String(request.nextUrl.searchParams.get('courier') || '').trim().toLowerCase();
    if (!waybill || !courier) {
      return NextResponse.json(
        { success: false, error: 'Parameter waybill dan courier wajib diisi' },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const provider = resolveShippingProvider(settings.provider);
    const tracking = await provider.getTracking(waybill, courier);

    return NextResponse.json({ success: true, data: tracking });
  } catch (error: unknown) {
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('Error tracking waybill:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gagal melacak resi' },
      { status: 500 }
    );
  }
}
