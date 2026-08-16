import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from '@/lib/crm/loyalty-engine';
import { restoreMerchandiseStockForOrder } from '@/lib/pos/merchandise-stock';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidNfcUid, normalizeNfcUid } from '@/lib/ticketing/server';
import { chargeFnbOrderToTab } from '@/lib/ticketing/tab-server';
import {
  redeemGiftCardForPosOrder,
  refundGiftCardForPosOrder,
} from '@/lib/giftcard/giftcard-server';
import { ensureQueueNumber } from '@/lib/pos/queue-number';
import { AccountingPostError } from '@/lib/pos/accounting-posting';
import { resolvePaymentCatalogStamp } from '@/lib/pos/payment-methods';
import { sanitizeXenditRef } from '@/lib/pos/xendit-ids';

type OrderPatchBody = {
  status?: string;
  payment_status?: string;
  payment_method?: string;
  amount_paid?: number | string;
  ark_coins_used?: number | string;
  notes?: string;
  changed_by?: string;
  status_notes?: string;
  /** UID gelang ticketing — wajib saat bayar open bill via 'nfc_tab' */
  nfc_tab_uid?: string;
  /** Kode gift card — wajib saat bayar open bill via 'gift_card' (EPIC-034) */
  gift_card_code?: string;
  xendit_qr_id?: string;
  xendit_external_id?: string;
  payment_method_code?: string;
  payment_method_name?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

// PATCH /api/pos/orders/:id - Update order status and payment
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Endpoint pemindah uang — sesi WAJIB tervalidasi penuh (middleware hanya
  // cek keberadaan cookie, bukan keabsahan token).
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const { id: orderId } = await params;
    const body = (await request.json()) as OrderPatchBody;
    const { status, payment_status, payment_method, amount_paid, ark_coins_used, notes } = body;

    // Convert to numbers
    const numericAmountPaid = Number(amount_paid) || 0;
    const numericArkUsed = Number(ark_coins_used) || 0;

    const updateData: Record<string, string | number | null> = {};
    if (status && status !== 'completed') updateData.status = status;
    if (payment_status) updateData.payment_status = payment_status;
    if (payment_method) updateData.payment_method = payment_method;
    if (amount_paid !== undefined) updateData.amount_paid = numericAmountPaid;
    if (ark_coins_used !== undefined) updateData.ark_coins_used = numericArkUsed;
    if (notes) updateData.notes = notes;
    const xenditQrId = sanitizeXenditRef(body.xendit_qr_id);
    const xenditExternalId = sanitizeXenditRef(body.xendit_external_id);
    if (xenditQrId) updateData.xendit_qr_id = xenditQrId;
    if (xenditExternalId) updateData.xendit_external_id = xenditExternalId;
    const catalog = resolvePaymentCatalogStamp({
      code: body.payment_method_code,
      name: body.payment_method_name,
    });
    if (catalog.payment_method_code) updateData.payment_method_code = catalog.payment_method_code;
    if (catalog.payment_method_name) updateData.payment_method_name = catalog.payment_method_name;

    // Payment no longer drives kitchen status. Client may still send
    // status=completed when paying; treat it as paid only.
    if (status === 'completed' || payment_status === 'paid') {
      updateData.payment_status = 'paid';
    }

    const { data: existing, error: fetchErr } = await db
      .from('pos_orders')
      .select('customer_id, payment_status, payment_method, total_amount, order_number, company_id, branch_id, queue_number, status')
      .eq('id', orderId)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ success: false, error: 'Order tidak ditemukan' }, { status: 404 });
    }

    // 1 pembayaran = 1 metode (EPIC-011): ARK Coin tidak boleh dicampur metode
    // lain, dan kalau metodenya ARK Coin maka harus menutup seluruh total.
    const effectiveMethod = payment_method ?? existing.payment_method ?? null;
    const orderTotal = Number(existing.total_amount) || 0;
    if (numericArkUsed > 0 && effectiveMethod !== 'ark_coin') {
      return NextResponse.json(
        { success: false, error: 'ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran' },
        { status: 400 }
      );
    }
    if (effectiveMethod === 'ark_coin' && ark_coins_used !== undefined && numericArkUsed < orderTotal) {
      return NextResponse.json(
        { success: false, error: 'Pembayaran ARK Coin harus menutup seluruh total order' },
        { status: 400 }
      );
    }

    // NFC Tab (EPIC-023 Fase C): bayar open bill dengan memindahkan tagihan
    // ke tab visit — charge dulu (transaksional + idempotent per order),
    // baru order ditandai paid. Order yang sudah paid tidak di-charge ulang.
    const paysWithNfcTab =
      effectiveMethod === 'nfc_tab' &&
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';
    if (paysWithNfcTab) {
      const rate = checkRateLimit(`pos-nfc-tab:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan NFC Tab — tunggu sebentar' },
          { status: 429 }
        );
      }
      // Order partial sudah menerima uang sebagian — full total ke tab bakal
      // menagih dobel. Tolak; NFC Tab hanya untuk order yang belum terbayar.
      if (existing.payment_status === 'partial') {
        return NextResponse.json(
          { success: false, error: 'Order sudah terbayar sebagian — NFC Tab hanya untuk order yang belum terbayar' },
          { status: 400 }
        );
      }
      const nfcTabUid = String(body.nfc_tab_uid || '').trim();
      if (!nfcTabUid) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran NFC Tab membutuhkan tap gelang' },
          { status: 400 }
        );
      }
      if (!isValidNfcUid(normalizeNfcUid(nfcTabUid))) {
        return NextResponse.json(
          { success: false, error: 'UID gelang tidak valid — tap ulang gelang' },
          { status: 400 }
        );
      }
      if (numericArkUsed > 0) {
        return NextResponse.json(
          { success: false, error: 'NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
          { status: 400 }
        );
      }
      if (!existing.company_id || !existing.branch_id) {
        return NextResponse.json(
          { success: false, error: 'Order tanpa venue — tidak bisa charge ke tab' },
          { status: 400 }
        );
      }
      const tabResult = await chargeFnbOrderToTab({
        orderId,
        orderNumber: String(existing.order_number || orderId),
        amount: orderTotal,
        bandUid: nfcTabUid,
        companyId: existing.company_id,
        branchId: existing.branch_id,
        createdBy: sessionUserId,
        // paid ditandai atomik bersama charge — update generik di bawah
        // hanya mengulang nilai yang sama (aman bila gagal)
        markOrderPaid: true,
      });
      if (!tabResult.ok) {
        console.error(
          `[pos] nfc_tab charge rejected: order=${orderId} user=${sessionUserId} reason=${tabResult.reason}`
        );
        return NextResponse.json(
          { success: false, error: tabResult.reason },
          { status: tabResult.status === 402 ? 400 : tabResult.status }
        );
      }
      updateData.amount_paid = 0;
    }

    // EPIC-034 Fase C — bayar open bill dengan saldo gift card. Pola persis
    // NFC Tab di atas: debit ber-lock dulu (idempoten per order), baru order
    // ditandai lunas oleh update generik di bawah. Full-cover only —
    // saldo kurang ditolak, kasir minta metode lain.
    const paysWithGiftCard =
      effectiveMethod === 'gift_card' &&
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';
    if (paysWithGiftCard) {
      const rate = checkRateLimit(`pos-gift-card:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan gift card — tunggu sebentar' },
          { status: 429 }
        );
      }
      // Order partial sudah menerima uang sebagian — debit full total bakal
      // menagih dobel (alasan sama dgn NFC Tab).
      if (existing.payment_status === 'partial') {
        return NextResponse.json(
          { success: false, error: 'Order sudah terbayar sebagian — gift card hanya untuk order yang belum terbayar' },
          { status: 400 }
        );
      }
      const giftCardCode = String(body.gift_card_code || '').trim().toUpperCase();
      if (!giftCardCode) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran gift card membutuhkan kode kartu' },
          { status: 400 }
        );
      }
      if (numericArkUsed > 0) {
        return NextResponse.json(
          { success: false, error: 'Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
          { status: 400 }
        );
      }
      if (!existing.company_id || !existing.branch_id) {
        return NextResponse.json(
          { success: false, error: 'Order tanpa venue — gift card tidak bisa dipakai' },
          { status: 400 }
        );
      }
      const redeem = await redeemGiftCardForPosOrder({
        scope: { companyId: existing.company_id, branchId: existing.branch_id },
        code: giftCardCode,
        amount: orderTotal,
        orderId,
        createdBy: sessionUserId,
      });
      if (!redeem.ok) {
        console.error(
          `[pos] gift_card debit rejected: order=${orderId} user=${sessionUserId} reason=${redeem.reason}`
        );
        return NextResponse.json(
          { success: false, error: redeem.reason },
          { status: redeem.status }
        );
      }
      // Uang masuk lewat saldo kartu, bukan laci kasir
      updateData.amount_paid = 0;
    }

    // Deduct ARK coins atomically BEFORE marking the order paid. The RPC locks
    // the customer row and rejects an insufficient balance in-transaction, so a
    // failed/insufficient deduction never leaves a paid order without the
    // matching coin debit (previously the failure was swallowed).
    if (numericArkUsed > 0) {
      if (existing.customer_id) {
        const { error: coinError } = await db.rpc('update_ark_coin_balance', {
          p_customer_id: existing.customer_id,
          p_amount: -numericArkUsed,
          p_type: 'payment',
          p_order_id: orderId,
        });

        if (coinError) {
          const insufficient = coinError.message?.includes('Insufficient');
          return NextResponse.json(
            { success: false, error: insufficient ? 'Saldo ARK Coin tidak cukup' : 'Gagal memproses ARK Coin' },
            { status: 400 }
          );
        }
      }
    }

    const { data, error } = await db
      .from('pos_orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (error) {
      // EPIC-034 Fase C — saldo sudah terpotong tapi order gagal ditandai
      // lunas → kembalikan saldo tamu (kompensasi otomatis, idempoten).
      if (paysWithGiftCard) {
        await refundGiftCardForPosOrder({
          scope: { companyId: existing.company_id, branchId: existing.branch_id },
          orderId,
          createdBy: sessionUserId,
          note: 'Pengembalian saldo — order gagal ditandai lunas',
        }).catch((refundErr) =>
          console.error(`[pos] gift_card refund failed: order=${orderId}:`, refundErr)
        );
      }
      throw error;
    }

    // EPIC-039 Fase A — order batal → kembalikan stok merchandise yang
    // sudah terpotong (idempoten via flag inventory_deducted per item).
    if (status === 'cancelled') {
      await restoreMerchandiseStockForOrder(db, orderId);
    }

    // Log status change
    if (status) {
      await db.from('pos_order_status_history').insert({
        order_id: orderId,
        from_status: null, // Should fetch previous status
        to_status: status,
        changed_by: body.changed_by || 'system',
        notes: body.status_notes
      });
    }

    const nowPaid =
      (updateData.payment_status === 'paid' || payment_status === 'paid') &&
      existing.payment_status !== 'paid';

    if (nowPaid) {
      const queueNumber = await ensureQueueNumber(db, {
        id: orderId,
        queue_number: existing.queue_number as string | null,
        company_id: existing.company_id as string | null,
        branch_id: existing.branch_id as string | null,
      });
      if (queueNumber && data) {
        (data as { queue_number?: string | null }).queue_number = queueNumber;
      }
    }

    let accountingNote: string | null = null;
    if (nowPaid) {
      try {
        const { postPosSaleAccountingJournals } = await import('@/lib/pos/accounting-posting');
        const accounting = await postPosSaleAccountingJournals({
          db,
          orderId,
          userId: sessionUserId,
          paymentMethod: effectiveMethod,
        });
        accountingNote = accounting.note;
      } catch (err) {
        if (err instanceof AccountingPostError) {
          return NextResponse.json({ success: false, error: err.message }, { status: 500 });
        }
        throw err;
      }
    }

    let crmXp = null;
    if (data.customer_id && (status === 'completed' || payment_status === 'paid')) {
      // Statistik kunjungan/belanja untuk SEMUA metode; hanya sekali per order
      // (saat transisi ke paid), agar visit_count tidak dobel.
      if (nowPaid) {
        await syncPosCustomerOrderStats(db, data.customer_id, Number(data.total_amount || 0));
      }

      const { data: orderItems } = await db
        .from('pos_order_items')
        .select('product_id, quantity, unit_price, subtotal, total_amount')
        .eq('order_id', orderId);

      crmXp = await awardCrmXpForPosOrder(db, {
        orderId,
        customerId: data.customer_id,
        totalAmount: Number(data.total_amount || 0),
        items: orderItems || [],
        outletId: data.branch_id || null,
        paymentMethod: effectiveMethod,
      });
    }

    return NextResponse.json({
      success: true,
      data,
      crm_xp: crmXp,
      message: accountingNote || undefined,
    });
  } catch (error: unknown) {
    console.error('Error updating order:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// GET /api/pos/orders/:id - Get single order details
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const db = createPgClient();
    const { id: orderId } = await params;

    const { data, error } = await db
      .from('pos_orders')
      .select(`
        *,
        customer:pos_customers(name, phone, membership_tier, ark_coin_balance),
        items:pos_order_items(*)
      `)
      .eq('id', orderId)
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('Error fetching order:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
