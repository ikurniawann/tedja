// EPIC-039 Fase F — daftar listing Shopee sebuah akun (utk mapping).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from '@/lib/db';
import {
  ensureFreshToken,
  resolveMarketplaceAdapter,
  MarketplaceError,
  type MarketplaceAccountRow,
} from '@/lib/shop/marketplace/sync';

export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const accountId = String(request.nextUrl.searchParams.get('account_id') || '');
    if (!z.string().uuid().safeParse(accountId).success) {
      return NextResponse.json({ success: false, error: 'account_id tidak valid' }, { status: 400 });
    }

    const account = await queryOne<MarketplaceAccountRow>(
      'SELECT * FROM shop.marketplace_accounts WHERE id = $1::uuid',
      [accountId]
    );
    if (!account) {
      return NextResponse.json({ success: false, error: 'Akun tidak ditemukan' }, { status: 404 });
    }

    const fresh = await ensureFreshToken(account);
    const adapter = resolveMarketplaceAdapter(fresh.channel_code);
    const listings = await adapter.listListings(fresh);
    return NextResponse.json({ success: true, data: listings });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof MarketplaceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[marketplace] listings error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat listing' }, { status: 500 });
  }
}
