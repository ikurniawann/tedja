// EPIC-039 Fase D — katalog publik storefront (tanpa auth, rate-limited).

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import {
  buildShopCatalog,
  releaseExpiredReservations,
  resolveStorefront,
} from '@/lib/shop/storefront-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`shop-catalog:${ip}`, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  try {
    const { slug } = await params;
    const storefront = await resolveStorefront(slug);
    if (!storefront) {
      return NextResponse.json({ success: false, error: 'Toko tidak ditemukan' }, { status: 404 });
    }

    // Opportunistik: reservasi kedaluwarsa dirilis supaya stok katalog akurat
    await releaseExpiredReservations();

    const products = await buildShopCatalog();
    return NextResponse.json({
      success: true,
      data: {
        storefront: {
          slug: storefront.slug,
          name: storefront.name,
          description: storefront.description,
        },
        products,
      },
    });
  } catch (error: unknown) {
    console.error('[shop] catalog error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat katalog' }, { status: 500 });
  }
}
