// EPIC-039 Fase F — mulai otorisasi toko Shopee: kembalikan URL auth_partner.

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { resolveMarketplaceAdapter, MarketplaceError } from '@/lib/shop/marketplace/sync';

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const adapter = resolveMarketplaceAdapter('shopee');
    const authUrl = adapter.buildAuthUrl(`${baseUrl}/api/shop/marketplace/callback`);
    return NextResponse.json({ success: true, data: { auth_url: authUrl } });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof MarketplaceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[marketplace] connect error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memulai otorisasi' }, { status: 500 });
  }
}
