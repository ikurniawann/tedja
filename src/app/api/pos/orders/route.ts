import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from '@/lib/crm/loyalty-engine';
import { getCrmDefaultVenue } from '@/lib/crm/server';
import { checkProductPrivileges } from '@/lib/crm/product-privilege';
import { buildCostSnapshot, loadPosProductCostMap } from '@/lib/pos/purchasing-sync';
import {
  claimMerchandiseStock,
  hasTrackedMerchandise,
  restoreMerchandiseStock,
  type MerchStockClaim,
} from '@/lib/pos/merchandise-stock';
import { normalizeGuestCount } from '@/lib/pos/guest-count';
import { withTransaction } from '@/lib/db';
import {
  PromoRejectedError,
  capturePromoRedemption,
  holdPromoRedemption,
  releasePromoRedemption,
  type PromoHold,
} from '@/lib/promo/promo-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidNfcUid, normalizeNfcUid } from '@/lib/ticketing/server';
import { chargeFnbOrderToTab } from '@/lib/ticketing/tab-server';
import {
  issueGiftCardsForPosOrder,
  prepareGiftCardSale,
  redeemGiftCardForPosOrder,
  refundGiftCardForPosOrder,
  type IssuedGiftCard,
} from '@/lib/giftcard/giftcard-server';
import { sendGiftCardSoldWa } from '@/lib/giftcard/gift-card-wa';

type PosOrderItemRequest = {
  product_id?: string;
  /** EPIC-039 Fase B — varian merchandise ber-stok; wajib utk produk ber-SKU */
  sku_id?: string;
  product_name?: string;
  product_sku?: string;
  quantity?: number | string;
  unit_price?: number | string;
  variant_price_adjustment?: number | string;
  modifier_price_adjustment?: number | string;
  variants?: unknown[];
  modifiers?: unknown[];
  station?: string;
};

type PosOrderBody = {
  order_type?: string;
  customer_id?: string;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong/aneh → 1 orang. */
  guest_count?: number | string;
  items?: PosOrderItemRequest[];
  subtotal?: number | string;
  discount_amount?: number | string;
  discount_reason?: string;
  /** EPIC-032 C1 — kode promo (server evaluasi & override diskon). */
  promo_code?: string;
  membership_discount_pct?: number | string;
  tax_amount?: number | string;
  service_charge_amount?: number | string;
  other_charges_amount?: number | string;
  charges_breakdown?: unknown;
  total_amount?: number | string;
  payment_method?: string;
  amount_paid?: number | string;
  notes?: string;
  special_requests?: string;
  ark_coins_used?: number | string;
  include_tax?: boolean;
  splits?: unknown[];
  branch_id?: string;
  shift_id?: string;
  /** UID gelang ticketing — wajib saat payment_method 'nfc_tab' (EPIC-023 Fase C) */
  nfc_tab_uid?: string;
  /** Kode gift card — wajib saat payment_method 'gift_card' (EPIC-034 Fase C) */
  gift_card_code?: string;
  /** Data pembeli saat MENJUAL gift card — nomor dipakai kirim kode via WA (Fase B) */
  gift_card_buyer_name?: string;
  gift_card_buyer_phone?: string;
};

type PosOrderRow = {
  table_id?: string | null;
  [key: string]: unknown;
};

type PosTableRow = {
  id: string;
  table_number?: string | null;
  qr_code?: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeStation(value?: string) {
  const station = String(value || '').trim().toLowerCase();
  if (['kitchen', 'bar', 'bakery', 'dessert', 'merchandise', 'photobooth'].includes(station)) {
    return station;
  }
  return 'kitchen';
}

// GET /api/pos/orders — list orders with filters
export async function GET(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const customerId = searchParams.get('customer_id');
    const paymentStatus = searchParams.get('payment_status');
    const orderType = searchParams.get('order_type');
    const activeOnly = searchParams.get('active_only') === 'true';
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = db
      .from('pos_orders')
      .select(`
        *,
        customer:pos_customers(name, phone),
        items:pos_order_items(*),
        splits:pos_order_splits(id, split_index, label, total_amount, amount_paid, status)
      `)
      .order('ordered_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);
    if (customerId) query = query.eq('customer_id', customerId);
    if (paymentStatus) query = query.eq('payment_status', paymentStatus);
    if (orderType) query = query.eq('order_type', orderType);
    if (activeOnly) query = query.not('status', 'in', '("completed","cancelled","voided","merged")');

    const { data, error } = await query;
    if (error) throw error;

    const orderRows = (data || []) as PosOrderRow[];
    const tableIds = Array.from(
      new Set(
        orderRows
          .map((order) => order.table_id)
          .filter((value): value is string => typeof value === 'string' && isUuid(value))
      )
    );
    let tableById = new Map<string, { table_number?: string | null; qr_code?: string | null }>();
    if (tableIds.length > 0) {
      const { data: tables, error: tableError } = await db
        .from('pos_tables')
        .select('id, table_number, qr_code')
        .in('id', tableIds);

      if (tableError) throw tableError;
      tableById = new Map(
        ((tables || []) as PosTableRow[]).map((table) => [
          String(table.id),
          { table_number: table.table_number, qr_code: table.qr_code },
        ])
      );
    }

    const ordersWithTables = orderRows.map((order) => ({
      ...order,
      table: order.table_id ? tableById.get(order.table_id) || null : null,
    }));

    return NextResponse.json({ success: true, data: ordersWithTables });
  } catch (error: unknown) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

// POST /api/pos/orders — create new order via atomic RPC
export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  // EPIC-039 Fase A — klaim stok merchandise yang harus dikembalikan bila
  // order gagal dibuat. Kosong = tidak ada yang perlu dikompensasi.
  let merchClaims: MerchStockClaim[] = [];

  try {
    const body = (await request.json()) as PosOrderBody;
    const {
      order_type = 'dine_in',
      customer_id,
      cashier_id,
      server_id,
      table_id,
      items = [],
      subtotal,
      discount_amount = 0,
      discount_reason,
      tax_amount = 0,
      service_charge_amount = 0,
      other_charges_amount = 0,
      charges_breakdown = [],
      total_amount,
      payment_method = 'cash',
      amount_paid = 0,
      notes,
      special_requests,
      ark_coins_used = 0,
      include_tax = false,
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: 'Items and total amount are required' }, { status: 400 });
    }

    const effectiveCashierId = cashier_id || await resolveCashierId();
    const splits = Array.isArray(body.splits) ? body.splits : [];

    const db = createPgClient();

    // Produk privilege (min_xp): tolak sebelum order dibuat — EPIC-011 Fase C
    const privilege = await checkProductPrivileges(
      db,
      items.map((item) => String(item.product_id || '')),
      customer_id
    );
    if (!privilege.allowed) {
      return NextResponse.json(
        { success: false, error: privilege.message },
        { status: 403 }
      );
    }

    // ── EPIC-034 Fase B — penjualan gift card ──────────────────────────
    // Nominal gift card DIKETIK kasir, jadi tidak dipercaya mentah: server
    // memuat ulang product_kind dari katalog dan memvalidasi tiap nominal ke
    // konfigurasi. Kartu baru terbit SETELAH order lunas (di bawah).
    const giftCardSale = await prepareGiftCardSale(items);
    if (!giftCardSale.ok) {
      return NextResponse.json(
        { success: false, error: giftCardSale.reason },
        { status: 400 }
      );
    }
    const giftCardNominals = giftCardSale.nominals;
    const sellsGiftCard = giftCardNominals.length > 0;

    // Split bill mode
    if (splits && splits.length > 0) {
      // EPIC-034 Fase B — penjualan gift card belum didukung utk split bill:
      // satu kartu tidak bisa dibagi ke beberapa pembayar (MVP, pola promo).
      if (sellsGiftCard) {
        return NextResponse.json(
          { success: false, error: 'Gift card belum didukung untuk split bill' },
          { status: 400 }
        );
      }
      // EPIC-032 C1 — promo belum didukung utk split bill (MVP)
      if (String(body.promo_code || '').trim()) {
        return NextResponse.json(
          { success: false, error: 'Kode promo belum didukung untuk split bill' },
          { status: 400 }
        );
      }
      // EPIC-039 Fase A — merchandise ber-stok belum didukung utk split bill:
      // jalur split memakai RPC lama yang tidak tahu deduksi stok merchandise
      // (MVP, pola gift card di atas).
      if (await hasTrackedMerchandise(db, items)) {
        return NextResponse.json(
          { success: false, error: 'Merchandise belum didukung untuk split bill' },
          { status: 400 }
        );
      }
      const rpcPayload = {
        p_order_type: order_type,
        p_customer_id: customer_id || null,
        p_cashier_id: effectiveCashierId,
        p_server_id: server_id || null,
        p_table_id: table_id || null,
        p_subtotal: Number(subtotal) || 0,
        p_discount_amount: Number(discount_amount) || 0,
        p_discount_reason: discount_reason || null,
        p_tax_amount: include_tax ? Number(tax_amount) || 0 : 0,
        p_service_charge_amount: Number(service_charge_amount) || 0,
        p_total_amount: Number(total_amount) || 0,
        p_notes: notes || null,
        p_special_requests: special_requests || null,
        p_items: items,
        p_splits: splits,
        p_branch_id: body.branch_id || null,
      };

      const { data: rpcResult, error: rpcError } = await db.rpc(
        'pos_create_split_order_transaction',
        rpcPayload
      );
      if (rpcError) {
        console.error('RPC split error:', rpcError);
        return NextResponse.json({ success: false, error: rpcError.message }, { status: 500 });
      }
      const result = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
      if (!result?.success) {
        return NextResponse.json({ success: false, error: result?.error || 'Split order creation failed' }, { status: 400 });
      }

      // Link shift if provided
      if (body.shift_id) {
        await db.from('pos_orders').update({ shift_id: body.shift_id }).eq('id', result.order_id);
      }

      // Jumlah tamu di-set setelah RPC, mengikuti pola shift_id di atas —
      // RPC `pos_create_split_order_transaction` punya signature tetap dan
      // mengubahnya berarti migrasi function. Tanpa ini, justru split bill
      // (yang hampir pasti banyak orang) akan tercatat 1 tamu karena DEFAULT
      // kolomnya.
      await db
        .from('pos_orders')
        .update({ guest_count: normalizeGuestCount(body.guest_count) })
        .eq('id', result.order_id);

      // Fetch complete order with relations
      const { data: completeOrder } = await db
        .from('pos_orders')
        .select(`*, customer:pos_customers(name, phone), items:pos_order_items(*), splits:pos_order_splits(*)`)
        .eq('id', result.order_id)
        .single();

      return NextResponse.json({
        success: true,
        data: completeOrder || result,
      }, { status: 201 });
    }

    // Single-payment flow
    // Avoid the old DB RPC because some deployed databases still have p_order_type TEXT
    // inserted into pos_order_type enum without casting.
    const { data: orderNumData, error: orderNumErr } = await db.rpc('generate_order_number');
    if (orderNumErr) {
      return NextResponse.json({ success: false, error: orderNumErr.message }, { status: 500 });
    }

    const orderNumber = typeof orderNumData === 'string' ? orderNumData : String(orderNumData);
    const serverSubtotal = items.reduce((sum: number, item: PosOrderItemRequest) => {
      const qty = Number(item.quantity) || 1;
      const unit = Number(item.unit_price) || 0;
      const variantAdj = Number(item.variant_price_adjustment) || 0;
      const modifierAdj = Number(item.modifier_price_adjustment) || 0;
      return sum + ((unit + variantAdj + modifierAdj) * qty);
    }, 0);
    let serverDiscount = Number(discount_amount) || 0;
    let discountReasonFinal: string | null = discount_reason || null;
    const serverTax = Number(tax_amount) || 0;
    const serverServiceCharge = Number(service_charge_amount) || 0;
    const serverOtherCharges = Number(other_charges_amount) || 0;
    const serverChargesBreakdown = Array.isArray(charges_breakdown) ? charges_breakdown : [];

    // ── EPIC-032 C1 — kode promo kasir ─────────────────────────────
    // Hold DI AWAL dgn id order yang di-generate sendiri (insert pakai id
    // eksplisit) supaya kuota terkunci sebelum uang diterima; diskon =
    // turunan SERVER (membership dari pct + promo dari engine), klien
    // hanya diverifikasi. Gagal lolos → 422 sebelum ada baris order.
    const promoCode = String(body.promo_code || '').trim();
    let promoHold: PromoHold | null = null;
    let promoOrderId: string | null = null;
    const venue = await getCrmDefaultVenue(db);
    if (promoCode) {
      const promoCompanyId = venue.companyId;
      const promoBranchId = body.branch_id || venue.branchId;
      if (!promoCompanyId || !promoBranchId) {
        return NextResponse.json(
          { success: false, error: 'Venue belum dikonfigurasi — kode promo tidak bisa dipakai' },
          { status: 400 }
        );
      }
      const promoScope = { companyId: promoCompanyId, branchId: promoBranchId };
      promoOrderId = randomUUID();
      try {
        promoHold = await withTransaction((client) =>
          holdPromoRedemption(client, {
            scope: promoScope,
            code: promoCode,
            channel: 'pos',
            contextType: 'pos_order',
            contextId: promoOrderId!,
            subtotal: serverSubtotal,
            phone: null,
            customerId: customer_id || null,
          })
        );
      } catch (promoErr) {
        if (promoErr instanceof PromoRejectedError) {
          return NextResponse.json(
            { success: false, error: promoErr.message },
            { status: 422 }
          );
        }
        throw promoErr;
      }
      const membershipPct = Number(body.membership_discount_pct) || 0;
      const membershipAmt =
        membershipPct > 0 ? Math.floor((serverSubtotal * membershipPct) / 100) : 0;
      const authoritativeDiscount = Math.min(
        serverSubtotal,
        membershipAmt + promoHold.discount
      );
      // Klien wajib menghitung angka yang sama — selisih > 1 rupiah =
      // state basi (mis. cart berubah setelah kode dipakai) → tolak rapi
      if (Math.abs(serverDiscount - authoritativeDiscount) > 1) {
        await withTransaction((client) =>
          releasePromoRedemption(client, 'pos_order', promoOrderId!)
        ).catch(() => {});
        return NextResponse.json(
          {
            success: false,
            error:
              'Total diskon tidak cocok dengan kode promo — muat ulang dan coba lagi',
          },
          { status: 400 }
        );
      }
      serverDiscount = authoritativeDiscount;
      discountReasonFinal = [discount_reason, `PROMO ${promoCode.toUpperCase()}`]
        .filter(Boolean)
        .join(' + ');
    }

    const serverDerivedTotal =
      serverSubtotal - serverDiscount + serverTax + serverServiceCharge + serverOtherCharges;
    // NFC Tab (EPIC-023 Fase C): order lunas secara kasir, tagihannya pindah
    // ke tab visit ticketing — tidak ada uang diterima di sini. Nominal yang
    // masuk ledger tab WAJIB turunan server, bukan total_amount kiriman klien.
    // Order ber-promo juga WAJIB turunan server (klien tak dipercaya).
    const isNfcTab = payment_method === 'nfc_tab';
    // EPIC-034 Fase C — bayar dgn saldo gift card: nominal debit WAJIB
    // turunan server (uang titipan tamu), persis alasan yang sama dgn NFC Tab.
    const payWithGiftCard = payment_method === 'gift_card';
    const serverTotal = isNfcTab || payWithGiftCard || promoHold
      ? serverDerivedTotal
      : Number(total_amount) || serverDerivedTotal;
    const paidAmount = Number(amount_paid) || 0;
    const arkUsed = Number(ark_coins_used) || 0;
    const nfcTabUid = String(body.nfc_tab_uid || '').trim();
    const giftCardCode = String(body.gift_card_code || '').trim().toUpperCase();

    if (isNfcTab) {
      const rate = checkRateLimit(`pos-nfc-tab:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan NFC Tab — tunggu sebentar' },
          { status: 429 }
        );
      }
    }
    if (isNfcTab && !nfcTabUid) {
      return NextResponse.json(
        { success: false, error: 'Pembayaran NFC Tab membutuhkan tap gelang' },
        { status: 400 }
      );
    }
    if (isNfcTab && !isValidNfcUid(normalizeNfcUid(nfcTabUid))) {
      return NextResponse.json(
        { success: false, error: 'UID gelang tidak valid — tap ulang gelang' },
        { status: 400 }
      );
    }
    if (isNfcTab && arkUsed > 0) {
      return NextResponse.json(
        { success: false, error: 'NFC Tab tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
        { status: 400 }
      );
    }

    // ── EPIC-034 Fase C — guard pembayaran gift card ───────────────────
    if (payWithGiftCard) {
      const rate = checkRateLimit(`pos-gift-card:${sessionUserId}`, 30);
      if (!rate.allowed) {
        return NextResponse.json(
          { success: false, error: 'Terlalu banyak percobaan gift card — tunggu sebentar' },
          { status: 429 }
        );
      }
      if (!giftCardCode) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran gift card membutuhkan kode kartu' },
          { status: 400 }
        );
      }
      if (arkUsed > 0) {
        return NextResponse.json(
          { success: false, error: 'Gift card tidak bisa dicampur ARK Coin — 1 transaksi 1 metode' },
          { status: 400 }
        );
      }
      if (!venue.companyId || !venue.branchId) {
        return NextResponse.json(
          { success: false, error: 'Venue belum dikonfigurasi — gift card tidak bisa dipakai' },
          { status: 400 }
        );
      }
    }
    // Saldo titipan/loyalitas tidak boleh dipakai MEMBELI saldo titipan baru
    // (gift card beli gift card = uang berputar tanpa kas masuk).
    if (sellsGiftCard && (payWithGiftCard || isNfcTab || payment_method === 'ark_coin')) {
      return NextResponse.json(
        {
          success: false,
          error: 'Gift card harus dibeli dengan pembayaran tunai/kartu/QRIS, bukan saldo',
        },
        { status: 400 }
      );
    }

    if (!isNfcTab && !payWithGiftCard && paidAmount + arkUsed < serverTotal) {
      return NextResponse.json({ success: false, error: 'Payment insufficient' }, { status: 400 });
    }

    // 1 pembayaran = 1 metode (EPIC-011): ARK Coin tidak boleh dicampur metode
    // lain, dan pembayaran ARK Coin harus menutup seluruh total.
    if (arkUsed > 0 && payment_method !== 'ark_coin') {
      return NextResponse.json(
        { success: false, error: 'ARK Coin tidak bisa dicampur metode lain — 1 transaksi 1 metode pembayaran' },
        { status: 400 }
      );
    }
    if (payment_method === 'ark_coin') {
      if (!customer_id) {
        return NextResponse.json({ success: false, error: 'Pembayaran ARK Coin membutuhkan customer' }, { status: 400 });
      }
      if (arkUsed < serverTotal) {
        return NextResponse.json(
          { success: false, error: 'Pembayaran ARK Coin harus menutup seluruh total order' },
          { status: 400 }
        );
      }
    }

    const payWithArk = arkUsed > 0 && Boolean(customer_id);
    // Order ARK/NFC Tab/Gift Card dibuat pending dulu; paid setelah
    // debit/charge sukses
    const deferPaid = payWithArk || isNfcTab || payWithGiftCard;

    // EPIC-039 Fase A — klaim stok merchandise SEBELUM order dibuat
    // (decrement atomik ber-guard di SQL; dua kasir memperebutkan stok
    // terakhir → satu gagal). Produk non-merchandise dilewati fungsi SQL.
    const merchClaimResult = await claimMerchandiseStock(db, items);
    if (!merchClaimResult.ok) {
      if (promoOrderId) {
        await withTransaction((client) =>
          releasePromoRedemption(client, 'pos_order', promoOrderId!)
        ).catch(() => {});
      }
      return NextResponse.json(
        { success: false, error: merchClaimResult.reason },
        { status: merchClaimResult.status }
      );
    }
    merchClaims = merchClaimResult.claims;
    const merchClaimedIds = new Set(merchClaims.map((claim) => claim.productId));

    const { data: orderData, error: orderErr } = await db
      .from('pos_orders')
      .insert({
        ...(promoOrderId ? { id: promoOrderId } : {}),
        order_number: orderNumber,
        order_type,
        status: deferPaid ? 'pending' : 'completed',
        payment_status: deferPaid ? 'unpaid' : 'paid',
        company_id: venue.companyId,
        branch_id: body.branch_id || venue.branchId,
        customer_id: customer_id || null,
        cashier_id: effectiveCashierId,
        server_id: server_id || null,
        table_id: table_id || null,
        guest_count: normalizeGuestCount(body.guest_count),
        shift_id: body.shift_id || null,
        subtotal: serverSubtotal,
        discount_amount: serverDiscount,
        discount_reason: discountReasonFinal,
        tax_amount: serverTax,
        service_charge_amount: serverServiceCharge,
        other_charges_amount: serverOtherCharges,
        charges_breakdown: serverChargesBreakdown,
        total_amount: serverTotal,
        amount_paid: paidAmount,
        change_amount: Math.max(0, paidAmount + arkUsed - serverTotal),
        payment_method,
        ark_coins_used: arkUsed,
        notes: notes || null,
        special_requests: special_requests || null,
        ordered_at: new Date().toISOString(),
        ...(deferPaid ? {} : { completed_at: new Date().toISOString() }),
      })
      .select()
      .single();

    if (orderErr || !orderData) {
      console.error('Order insert error:', orderErr);
      await restoreMerchandiseStock(db, merchClaims);
      merchClaims = [];
      if (promoOrderId) {
        await withTransaction((client) =>
          releasePromoRedemption(client, 'pos_order', promoOrderId!)
        ).catch(() => {});
      }
      return NextResponse.json({ success: false, error: orderErr?.message || 'Failed to create order' }, { status: 500 });
    }

    // Debit saldo ARK atomik (fix bug: checkout langsung sebelumnya tidak
    // pernah memotong saldo). Gagal debit → order dibatalkan, bukan paid.
    // Charge tab ticketing + tandai order paid dalam SATU transaksi DB
    // (lock visit + guard saldo/plafon di dalamnya) — charge dan status
    // order tidak mungkin terpisah. Gagal charge → order dibatalkan.
    if (isNfcTab) {
      const tabResult = await chargeFnbOrderToTab({
        orderId: orderData.id,
        orderNumber,
        amount: serverTotal,
        bandUid: nfcTabUid,
        companyId: venue.companyId,
        branchId: body.branch_id || venue.branchId,
        createdBy: sessionUserId,
        markOrderPaid: true,
      });

      if (!tabResult.ok) {
        // Jejak audit sebelum order kompensasi dihapus (percobaan gagal
        // tidak meninggalkan baris DB)
        console.error(
          `[pos] nfc_tab charge rejected: order=${orderData.id} user=${sessionUserId} reason=${tabResult.reason}`
        );
        await restoreMerchandiseStock(db, merchClaims);
        merchClaims = [];
        const { error: delErr } = await db
          .from('pos_orders')
          .delete()
          .eq('id', orderData.id);
        if (delErr) {
          console.error(
            `[pos] nfc_tab compensation delete failed: order=${orderData.id}:`,
            delErr
          );
          // Jangan biarkan order zombie pending nongol di daftar aktif kasir
          await db
            .from('pos_orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', orderData.id);
        }
        if (promoOrderId) {
          await withTransaction((client) =>
            releasePromoRedemption(client, 'pos_order', promoOrderId!)
          ).catch(() => {});
        }
        return NextResponse.json(
          { success: false, error: tabResult.reason },
          { status: tabResult.status === 402 ? 400 : tabResult.status }
        );
      }

      orderData.status = 'completed';
      orderData.payment_status = 'paid';
    }

    // EPIC-034 Fase C — debit saldo gift card. Kartu dikunci FOR UPDATE di
    // dalam transaksinya sendiri (dua kasir memakai kartu yang sama tidak
    // bisa membuat saldo minus). Gagal debit → order dikompensasi, bukan paid.
    const giftCardScope = {
      companyId: venue.companyId as string,
      branchId: (body.branch_id || venue.branchId) as string,
    };
    if (payWithGiftCard) {
      const redeem = await redeemGiftCardForPosOrder({
        scope: giftCardScope,
        code: giftCardCode,
        amount: serverTotal,
        orderId: orderData.id,
        createdBy: sessionUserId,
      });

      if (!redeem.ok) {
        // Jejak audit sebelum order kompensasi dihapus
        console.error(
          `[pos] gift_card debit rejected: order=${orderData.id} user=${sessionUserId} reason=${redeem.reason}`
        );
        await restoreMerchandiseStock(db, merchClaims);
        merchClaims = [];
        const { error: delErr } = await db
          .from('pos_orders')
          .delete()
          .eq('id', orderData.id);
        if (delErr) {
          console.error(
            `[pos] gift_card compensation delete failed: order=${orderData.id}:`,
            delErr
          );
          await db
            .from('pos_orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', orderData.id);
        }
        if (promoOrderId) {
          await withTransaction((client) =>
            releasePromoRedemption(client, 'pos_order', promoOrderId!)
          ).catch(() => {});
        }
        return NextResponse.json(
          { success: false, error: redeem.reason },
          { status: redeem.status === 409 ? 409 : redeem.status === 404 ? 404 : 400 }
        );
      }

      const { error: markPaidErr } = await db
        .from('pos_orders')
        .update({
          status: 'completed',
          payment_status: 'paid',
          completed_at: new Date().toISOString(),
        })
        .eq('id', orderData.id);
      if (markPaidErr) {
        // Saldo sudah terpotong tapi order tak bisa ditandai lunas →
        // kembalikan saldo (keputusan owner 27 Jul: kompensasi otomatis).
        await refundGiftCardForPosOrder({
          scope: giftCardScope,
          orderId: orderData.id,
          createdBy: sessionUserId,
          note: 'Pengembalian saldo — order gagal ditandai lunas',
        }).catch((err) =>
          console.error(`[pos] gift_card refund failed: order=${orderData.id}:`, err)
        );
        throw markPaidErr;
      }
      orderData.status = 'completed';
      orderData.payment_status = 'paid';
    }

    if (payWithArk) {
      const { error: coinError } = await db.rpc('update_ark_coin_balance', {
        p_customer_id: customer_id,
        p_amount: -arkUsed,
        p_type: 'payment',
        p_order_id: orderData.id,
      });

      if (coinError) {
        await restoreMerchandiseStock(db, merchClaims);
        merchClaims = [];
        await db.from('pos_orders').delete().eq('id', orderData.id);
        if (promoOrderId) {
          await withTransaction((client) =>
            releasePromoRedemption(client, 'pos_order', promoOrderId!)
          ).catch(() => {});
        }
        const insufficient = coinError.message?.includes('Insufficient');
        return NextResponse.json(
          { success: false, error: insufficient ? 'Saldo ARK Coin tidak cukup' : 'Gagal memproses ARK Coin' },
          { status: 400 }
        );
      }

      const { error: markPaidErr } = await db
        .from('pos_orders')
        .update({
          status: 'completed',
          payment_status: 'paid',
          completed_at: new Date().toISOString(),
        })
        .eq('id', orderData.id);
      if (markPaidErr) throw markPaidErr;
      orderData.status = 'completed';
      orderData.payment_status = 'paid';
    }

    const productCostMap = await loadPosProductCostMap(
      db,
      items.map((item) => String(item.product_id || '')).filter(Boolean)
    );

    const orderItems = items.map((item: PosOrderItemRequest) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice =
        (Number(item.unit_price) || 0) +
        (Number(item.variant_price_adjustment) || 0) +
        (Number(item.modifier_price_adjustment) || 0);
      const subtotalValue = unitPrice * qty;
      const costSnapshot = buildCostSnapshot(
        item.product_id ? productCostMap.get(item.product_id) : undefined,
        qty,
        subtotalValue
      );

      return {
        order_id: orderData.id,
        product_id: item.product_id,
        sku_id: item.sku_id || null,
        product_name: item.product_name || 'Unknown',
        product_sku: String(item.product_sku || item.product_id || '').slice(0, 50),
        variants: item.variants || [],
        modifiers: item.modifiers || [],
        quantity: qty,
        unit_price: unitPrice,
        subtotal: subtotalValue,
        discount_amount: 0,
        total_amount: subtotalValue,
        xp_earned: 0,
        station: normalizeStation(item.station),
        kitchen_status: 'pending',
        // EPIC-039 Fase A — true untuk baris merchandise yang stoknya sudah
        // diklaim di atas; dipakai restore saat order dibatalkan.
        inventory_deducted: item.product_id
          ? merchClaimedIds.has(String(item.product_id))
          : false,
        ...costSnapshot,
      };
    });

    let { error: itemsErr } = await db.from('pos_order_items').insert(orderItems);
    if (itemsErr?.code === '42703' || itemsErr?.code === 'PGRST204') {
      const legacyItems = orderItems.map((item) => {
        const legacyItem = { ...item } as Partial<typeof item>;
        delete legacyItem.station;
        delete legacyItem.kitchen_status;
        delete legacyItem.sku_id;
        delete legacyItem.cost_price;
        delete legacyItem.cost_total;
        delete legacyItem.gross_profit;
        delete legacyItem.gross_margin_pct;
        return legacyItem;
      });
      const legacyResult = await db.from('pos_order_items').insert(legacyItems);
      itemsErr = legacyResult.error;
    }
    if (itemsErr) {
      console.error('Order items insert error:', itemsErr);
      await restoreMerchandiseStock(db, merchClaims);
      merchClaims = [];
      // EPIC-034 Fase C — saldo sudah terpotong tapi order tak lengkap →
      // kembalikan saldo tamu (kompensasi otomatis, idempoten).
      if (payWithGiftCard) {
        await refundGiftCardForPosOrder({
          scope: giftCardScope,
          orderId: orderData.id,
          createdBy: sessionUserId,
          note: 'Pengembalian saldo — baris order gagal disimpan',
        }).catch((err) =>
          console.error(`[pos] gift_card refund failed: order=${orderData.id}:`, err)
        );
      }
      return NextResponse.json({ success: false, error: itemsErr.message }, { status: 500 });
    }

    // Baris order tersimpan — stok merchandise resmi milik order ini.
    // Pembatalan setelah titik ini dikembalikan lewat jalur cancel/void
    // (restoreMerchandiseStockForOrder), bukan kompensasi catch.
    merchClaims = [];

    await db.from('pos_order_status_history').insert({
      order_id: orderData.id,
      from_status: null,
      to_status: 'completed',
      changed_by: effectiveCashierId,
      notes: 'Order created and paid from cashier',
    });

    // Statistik kunjungan/belanja untuk semua metode pembayaran
    if (customer_id) {
      await syncPosCustomerOrderStats(db, customer_id, serverTotal);
    }

    const crmXp = await awardCrmXpForPosOrder(db, {
      orderId: orderData.id,
      customerId: customer_id || null,
      totalAmount: serverTotal,
      items: orderItems,
      outletId: body.branch_id || venue.branchId,
      paymentMethod: payment_method,
    });

    // EPIC-032 C1 — order lunas → pemakaian kode FINAL (held → captured).
    // Void order melepasnya kembali (route void).
    if (promoOrderId) {
      await withTransaction((client) =>
        capturePromoRedemption(client, 'pos_order', promoOrderId!)
      ).catch((err) => console.error('[pos] capture promo error:', err));
    }

    // ── EPIC-034 Fase B — kartu terbit setelah order LUNAS ─────────────
    // Idempoten per order (retry tidak menggandakan kartu). Gagal terbit
    // TIDAK membatalkan order yang sudah dibayar — kasir diberi peringatan
    // keras supaya kasusnya ditangani admin, bukan hilang diam-diam.
    let giftCardsIssued: IssuedGiftCard[] = [];
    let giftCardIssueError: string | null = null;
    if (sellsGiftCard) {
      const buyerName = String(body.gift_card_buyer_name || '').trim() || null;
      const buyerPhone = String(body.gift_card_buyer_phone || '').trim() || null;
      try {
        giftCardsIssued = await issueGiftCardsForPosOrder({
          scope: giftCardScope,
          orderId: orderData.id,
          nominals: giftCardNominals,
          buyerName,
          buyerPhone,
          createdBy: sessionUserId,
        });
      } catch (giftErr) {
        console.error(
          `[pos] gift card issue failed: order=${orderData.id}:`,
          giftErr
        );
        giftCardIssueError =
          'Order LUNAS tapi kartu gagal terbit — catat nomor order dan hubungi admin';
      }

      // WA hanya tambahan; kode tetap tercetak di struk (keputusan owner).
      if (giftCardsIssued.length > 0 && buyerPhone) {
        void sendGiftCardSoldWa({
          buyerName,
          buyerPhone,
          cards: giftCardsIssued,
        }).catch((waErr) =>
          console.error(`[pos] gift card WA failed: order=${orderData.id}:`, waErr)
        );
      }
    }

    const { data: completeOrder } = await db
      .from('pos_orders')
      .select(`*, customer:pos_customers(name, phone), items:pos_order_items(*)`)
      .eq('id', orderData.id)
      .single();

    return NextResponse.json(
      {
        success: true,
        data: completeOrder || orderData,
        crm_xp: crmXp,
        ...(sellsGiftCard
          ? { gift_cards: giftCardsIssued, gift_card_error: giftCardIssueError }
          : {}),
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('Error creating order:', error);
    if (merchClaims.length > 0) {
      // Error dilempar setelah stok diklaim (mis. markPaidErr) → kembalikan.
      await restoreMerchandiseStock(createPgClient(), merchClaims).catch((restoreErr) =>
        console.error('[pos] merch stock restore in catch failed:', restoreErr)
      );
      merchClaims = [];
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

async function resolveCashierId(): Promise<string> {
  // In production, map session user to hrd.employees.id
  // For now, return a fallback/demo ID
  return '00000000-0000-0000-0000-000000000001';
}
