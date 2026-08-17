// EPIC-039 Fase F — redirect balik dari otorisasi Shopee (?code&shop_id).
// Butuh sesi admin (owner memulai dari dashboard di browser yang sama).

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { query } from '@/lib/db';
import {
  resolveMarketplaceAdapter,
  logSync,
  MarketplaceError,
} from '@/lib/shop/marketplace/sync';

export async function GET(request: NextRequest) {
  const dashboardUrl = '/dashboard/shop/marketplace';
  try {
    await requireIamMenuPrefix(IAM.shop);
    const code = String(request.nextUrl.searchParams.get('code') || '').trim();
    const shopId = String(request.nextUrl.searchParams.get('shop_id') || '').trim();
    if (!code || !shopId) {
      return NextResponse.redirect(new URL(`${dashboardUrl}?error=callback-kosong`, request.url));
    }

    const adapter = resolveMarketplaceAdapter('shopee');
    const bundle = await adapter.exchangeCode(code, shopId);

    await query(
      `INSERT INTO shop.marketplace_accounts (
         channel_code, shop_id, access_token, refresh_token, token_expires_at, status
       ) VALUES ('shopee', $1, $2, $3, $4, 'connected')
       ON CONFLICT (channel_code, shop_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         status = 'connected',
         updated_at = now()`,
      [shopId, bundle.accessToken, bundle.refreshToken, bundle.expiresAt.toISOString()]
    );
    await logSync(null, 'auth', 'ok', { shop_id: shopId });

    return NextResponse.redirect(new URL(`${dashboardUrl}?connected=${shopId}`, request.url));
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('[marketplace] callback error:', error);
    const message =
      error instanceof MarketplaceError ? error.message : 'Gagal menghubungkan toko';
    return NextResponse.redirect(
      new URL(`${dashboardUrl}?error=${encodeURIComponent(message)}`, request.url)
    );
  }
}
