// EPIC-039 Fase F — sinkron manual satu akun: push stok + pull order.
// Endpoint sama bisa dipanggil cron eksternal dgn header
// x-sync-token = MARKETPLACE_SYNC_TOKEN (tanpa sesi admin).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { queryOne } from '@/lib/db';
import {
  pullMarketplaceOrders,
  pushAllStock,
  MarketplaceError,
  type MarketplaceAccountRow,
} from '@/lib/shop/marketplace/sync';

export async function POST(request: NextRequest) {
  try {
    const cronToken = process.env.MARKETPLACE_SYNC_TOKEN;
    const headerToken = request.headers.get('x-sync-token');
    if (!(cronToken && headerToken === cronToken)) {
      await requireIamMenuPrefix(IAM.shop);
    }

    const body = (await request.json().catch(() => ({}))) as { account_id?: string };
    const accountId = String(body.account_id || '');
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
    if (account.status === 'disconnected') {
      return NextResponse.json({ success: false, error: 'Akun terputus — hubungkan ulang' }, { status: 400 });
    }

    // Pull dulu (order memotong stok), baru push (stok terbaru ke marketplace)
    const pull = await pullMarketplaceOrders(account);
    const push = await pushAllStock(account);

    return NextResponse.json({ success: true, data: { pull, push } });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof MarketplaceError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.error('[marketplace] sync error:', error);
    return NextResponse.json({ success: false, error: 'Sinkronisasi gagal' }, { status: 500 });
  }
}
