import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { getCrmDefaultVenue } from '@/lib/crm/server';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

// GET /api/pos/topup/history - Get customer topup history
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get('customer_id');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = db
      .from('pos_wallet_transactions')
      .select(`
        *,
        customer:pos_customers(name, phone)
      `)
      .eq('type', 'topup')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('Error fetching topup history:', error, getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: 'Gagal memuat riwayat topup' },
      { status: 500 }
    );
  }
}

// POST /api/pos/topup - Process Ark Coin topup
export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const body = await request.json();
    const {
      customer_id,
      amount, // Fiat amount (IDR)
      payment_method = 'qris',
      xendit_transaction_id
    } = body;

    // Validate required fields
    if (!customer_id || !amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Customer ID and valid amount are required' },
        { status: 400 }
      );
    }

    // Balance is stored as Rupiah-equivalent; UI displays ARK with 1 ARK = Rp 1,000.
    const amountValue = Number(amount) || 0;

    // Topup atomik via RPC: lock saldo, insert wallet log, TANPA menambah
    // total_spent (top spender = nilai belanja) — EPIC-011 Fase A.
    const { companyId, branchId } = await getCrmDefaultVenue(db);
    const { data: topupResult, error: topupError } = await db.rpc('process_ark_topup', {
      p_customer_id: customer_id,
      p_amount: amountValue,
      p_payment_method: payment_method,
      p_xendit_transaction_id: xendit_transaction_id || null,
      p_company_id: companyId,
      p_branch_id: branchId,
    });

    if (topupError) {
      const notFound = topupError.message?.includes('not found');
      return NextResponse.json(
        { success: false, error: notFound ? 'Customer not found' : 'Gagal memproses topup' },
        { status: notFound ? 404 : 500 }
      );
    }

    const result = topupResult as {
      transaction_id: string;
      balance_before: number;
      balance_after: number;
      ark_coins: number;
    };

    const { data: transaction } = await db
      .from('pos_wallet_transactions')
      .select('*')
      .eq('id', result.transaction_id)
      .single();

    const balanceBefore = Number(result.balance_before) || 0;
    const balanceAfter = Number(result.balance_after) || 0;
    const arkCoins = Number(result.ark_coins) || 0;

    // 3. If QRIS, generate QR code URL (integrate with Xendit/Midtrans later)
    let qrCodeUrl = null;
    if (payment_method === 'qris') {
      // TODO: Integrate with Xendit QRIS API
      // For now, return mock QR code
      qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=QRIS_${Date.now()}`;
    }

    return NextResponse.json({
      success: true,
      data: {
        transaction,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        ark_coins: arkCoins,
        qr_code_url: qrCodeUrl
      }
    }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error processing topup:', error, getErrorMessage(error));
    return NextResponse.json(
      { success: false, error: 'Gagal memproses topup' },
      { status: 500 }
    );
  }
}
