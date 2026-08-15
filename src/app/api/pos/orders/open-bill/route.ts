import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { buildCostSnapshot, loadPosProductCostMap } from '@/lib/pos/purchasing-sync';
import { checkProductPrivileges } from '@/lib/crm/product-privilege';
import { normalizeGuestCount } from '@/lib/pos/guest-count';
import {
  assertOrderItemsMatchSellStall,
  resolvePosSellStallForUser,
} from '@/lib/pos/pos-sell-stall-server';
import { getCrmDefaultVenue } from '@/lib/crm/server';
import { allocateQueueNumber } from '@/lib/pos/queue-number';
import { buildKitchenPrintJobs, normalizeStation } from '@/lib/pos/kitchen-station';
import {
  buildDiscountReason,
  computeOrderDiscountStack,
  type DiscountType,
} from '@/lib/pos/manual-discount';
import { evaluateActiveOffersForPosCart } from '@/lib/promo/offer-pos';

type OpenBillItem = {
  product_id?: string;
  product_name?: string;
  product_sku?: string;
  variants?: unknown[];
  modifiers?: unknown[];
  quantity?: number | string;
  unit_price?: number | string;
  variant_price_adjustment?: number | string;
  modifier_price_adjustment?: number | string;
  subtotal?: number | string;
  total_amount?: number | string;
  discount_type?: string | null;
  discount_value?: number | string | null;
  discount_amount?: number | string;
  station?: string | null;
  kitchen_notes?: string | null;
  notes?: string | null;
};

type OpenBillBody = {
  order_type?: string;
  customer_id?: string;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  /** Jumlah tamu yang duduk (EPIC-038). Kosong/aneh → 1 orang. */
  guest_count?: number | string;
  shift_id?: string;
  items?: OpenBillItem[];
  subtotal?: number | string;
  discount_amount?: number | string;
  discount_reason?: string;
  manual_discount_type?: string | null;
  manual_discount_value?: number | string | null;
  tax_amount?: number | string;
  service_charge_amount?: number | string;
  other_charges_amount?: number | string;
  charges_breakdown?: unknown;
  total_amount?: number | string;
  notes?: string;
  special_requests?: string;
  membership_discount_pct?: number | string;
  /** Preview only — promo hold happens at pay time */
  promo_discount?: number | string;
  promo_code?: string;
};

type PrintJobItem = {
  id?: string;
  product_id?: string;
  product_name?: string;
  product_sku?: string;
  variants?: unknown;
  modifiers?: unknown;
  quantity?: number | string;
  unit_price?: number | string;
  total_amount?: number | string;
  station?: string | null;
  kitchen_notes?: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as OpenBillBody;
    const {
      order_type = 'dine_in',
      customer_id,
      cashier_id,
      server_id,
      table_id,
      shift_id,
      items = [],
      discount_reason,
      manual_discount_type = null,
      manual_discount_value = null,
      tax_amount = 0,
      service_charge_amount = 0,
      other_charges_amount = 0,
      charges_breakdown = [],
      notes,
      special_requests,
    } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: 'Items are required' }, { status: 400 });
    }

    const sellStall = await resolvePosSellStallForUser(sessionUserId);
    if (!sellStall.ok) {
      return NextResponse.json({ success: false, error: sellStall.message }, { status: 400 });
    }
    const itemStallCheck = await assertOrderItemsMatchSellStall(
      items.map((item) => String(item.product_id || '')),
      sellStall.warehouseId
    );
    if (!itemStallCheck.ok) {
      return NextResponse.json({ success: false, error: itemStallCheck.message }, { status: 400 });
    }

    // Produk privilege (min_xp) — EPIC-011 Fase C
    const dbPrivilege = createPgClient();
    const privilege = await checkProductPrivileges(
      dbPrivilege,
      items.map((item) => String(item.product_id || '')),
      customer_id
    );
    if (!privilege.allowed) {
      return NextResponse.json(
        { success: false, error: privilege.message },
        { status: 403 }
      );
    }

    const db = createPgClient();
    const venue = await getCrmDefaultVenue(db);

    // Generate order number via existing RPC
    const { data: orderNumData, error: orderNumErr } = await db.rpc('generate_order_number');
    if (orderNumErr) {
      console.error('Order number generation error:', orderNumErr);
      return NextResponse.json({ success: false, error: 'Failed to generate order number' }, { status: 500 });
    }
    const orderNumber = typeof orderNumData === 'string' ? orderNumData : String(orderNumData);
    const queueNumber = await allocateQueueNumber(db, venue.companyId, venue.branchId);

    const parseDiscountType = (raw: unknown): DiscountType | null =>
      raw === 'percent' || raw === 'fixed' ? raw : null;

    const offerEval = await evaluateActiveOffersForPosCart({
      companyId: venue.companyId,
      branchId: venue.branchId,
      items: items.map((item) => {
        const qty = Number(item.quantity) || 1;
        const unit = Number(item.unit_price) || 0;
        const variantAdj = Number(item.variant_price_adjustment) || 0;
        const modifierAdj = Number(item.modifier_price_adjustment) || 0;
        return {
          productId: String(item.product_id || ''),
          quantity: qty,
          unitPrice: unit + variantAdj + modifierAdj,
        };
      }),
    });

    const membershipPct = Number(body.membership_discount_pct) || 0;
    const manualType = parseDiscountType(manual_discount_type);
    const manualValue =
      manual_discount_value == null || manual_discount_value === ''
        ? null
        : Number(manual_discount_value);
    const promoDiscountPreview = Math.max(0, Number(body.promo_discount) || 0);

    const stack = computeOrderDiscountStack({
      items: items.map((item) => {
        const qty = Number(item.quantity) || 1;
        const unit = Number(item.unit_price) || 0;
        const variantAdj = Number(item.variant_price_adjustment) || 0;
        const modifierAdj = Number(item.modifier_price_adjustment) || 0;
        return {
          line_subtotal: (unit + variantAdj + modifierAdj) * qty,
          discount_type: parseDiscountType(item.discount_type),
          discount_value:
            item.discount_value == null || item.discount_value === ''
              ? null
              : Number(item.discount_value),
        };
      }),
      offer_discount: offerEval.offer_discount,
      membership_pct: membershipPct,
      promo_discount: promoDiscountPreview,
      manual_discount_type: manualType,
      manual_discount_value: manualValue,
    });

    const serverDiscountReason = buildDiscountReason({
      has_item_discounts: stack.line_discount_total > 0,
      offer_labels: offerEval.applied.map((a) => a.name),
      membership_pct: membershipPct,
      promo_code: body.promo_code || null,
      manual_type: manualType,
      manual_value: manualValue,
    });

    const orderPayload = {
      order_number: orderNumber,
      queue_number: queueNumber,
      order_type,
      status: 'pending',
      payment_status: 'unpaid',
      company_id: venue.companyId,
      branch_id: venue.branchId,
      warehouse_id: sellStall.warehouseId,
      customer_id: customer_id || null,
      cashier_id: cashier_id || sessionUserId,
      server_id: server_id || null,
      table_id: table_id || null,
      // Dinormalisasi di server, bukan dipercaya dari klien: jalur lain
      // (seat reservation, tablet) juga menembak endpoint ini.
      guest_count: normalizeGuestCount(body.guest_count),
      shift_id: shift_id || null,
      subtotal: stack.gross_subtotal,
      discount_amount: stack.discount_amount,
      discount_reason: serverDiscountReason || discount_reason || null,
      manual_discount_type: manualType,
      manual_discount_value: manualValue,
      tax_amount: Number(tax_amount) || 0,
      service_charge_amount: Number(service_charge_amount) || 0,
      other_charges_amount: Number(other_charges_amount) || 0,
      charges_breakdown: Array.isArray(charges_breakdown) ? charges_breakdown : [],
      total_amount:
        stack.after_discount +
        (Number(tax_amount) || 0) +
        (Number(service_charge_amount) || 0) +
        (Number(other_charges_amount) || 0),
      payment_method: null,
      amount_paid: 0,
      notes: notes || null,
      special_requests: special_requests || null,
      ark_coins_used: 0,
      ordered_at: new Date().toISOString(),
    };

    let { data: orderData, error: orderErr } = await db
      .from('pos_orders')
      .insert(orderPayload)
      .select()
      .single();

    if (orderErr?.code === '42703' || orderErr?.code === 'PGRST204') {
      const legacyPayload = { ...orderPayload };
      delete (legacyPayload as { queue_number?: string | null }).queue_number;
      delete (legacyPayload as { manual_discount_type?: string | null }).manual_discount_type;
      delete (legacyPayload as { manual_discount_value?: number | null }).manual_discount_value;
      const legacyResult = await db.from('pos_orders').insert(legacyPayload).select().single();
      orderData = legacyResult.data;
      orderErr = legacyResult.error;
    }

    if (orderErr || !orderData) {
      console.error('Open bill insert error:', orderErr);
      return NextResponse.json({ success: false, error: orderErr?.message || 'Failed to create order' }, { status: 500 });
    }

    // Adding a new open bill for a table clears Pre Settlement (back to orange).
    if (table_id) {
      const now = new Date().toISOString();
      const { error: clearError } = await db
        .from('pos_orders')
        .update({ pre_settled_at: null, updated_at: now })
        .eq('table_id', table_id)
        .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'served'])
        .not('pre_settled_at', 'is', null);

      if (clearError && clearError.code !== '42703' && clearError.code !== 'PGRST204') {
        console.error('Clear pre_settled_at error:', clearError);
      }
    }

    // Insert order items
    // Note: pos_order_items stores variant/modifier details in JSON columns.
    // The DB schema does not have separate variant_price_adjustment / modifier_price_adjustment columns,
    // so adjustments are folded into unit_price/subtotal/total_amount here.
    const productCostMap = await loadPosProductCostMap(
      db,
      items.map((item) => String(item.product_id || '')).filter(Boolean)
    );

    const orderItems = items.map((item, index) => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice =
        (Number(item.unit_price) || 0) +
        (Number(item.variant_price_adjustment) || 0) +
        (Number(item.modifier_price_adjustment) || 0);
      const subtotalValue = unitPrice * quantity;
      const line = stack.line_results[index];
      const discountAmount = line?.discount_amount ?? 0;
      const totalValue = line?.total_amount ?? Math.max(0, subtotalValue - discountAmount);
      const productName = String(item.product_name || 'Unknown');
      const kitchenNotes = String(item.kitchen_notes || item.notes || '');
      const costSnapshot = buildCostSnapshot(
        item.product_id ? productCostMap.get(item.product_id) : undefined,
        quantity,
        totalValue
      );
      const discType =
        item.discount_type === 'percent' || item.discount_type === 'fixed'
          ? item.discount_type
          : null;
      const discValue =
        item.discount_value == null || item.discount_value === ''
          ? null
          : Number(item.discount_value);

      return {
        order_id: orderData.id,
        product_id: item.product_id,
        product_name: productName,
        product_sku: String(item.product_sku || item.product_id || '').slice(0, 50),
        variants: item.variants || [],
        modifiers: item.modifiers || [],
        quantity,
        unit_price: unitPrice,
        subtotal: subtotalValue,
        discount_type: discType,
        discount_value: discValue,
        discount_amount: discountAmount,
        total_amount: totalValue,
        station: normalizeStation(item.station, productName, kitchenNotes),
        kitchen_status: 'pending',
        kitchen_notes: kitchenNotes || null,
        ...costSnapshot,
      };
    });

    let insertedItems: PrintJobItem[] | null = null;
    const insertResult = await db
      .from('pos_order_items')
      .insert(orderItems)
      .select('id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price, total_amount, station, kitchen_notes');
    insertedItems = insertResult.data as PrintJobItem[] | null;
    let itemsErr = insertResult.error;
    if (itemsErr?.code === '42703' || itemsErr?.code === 'PGRST204') {
      const legacyItems = orderItems.map((item) => {
        const legacyItem = { ...item } as Partial<typeof item>;
        delete legacyItem.station;
        delete legacyItem.kitchen_status;
        delete legacyItem.kitchen_notes;
        delete legacyItem.cost_price;
        delete legacyItem.cost_total;
        delete legacyItem.gross_profit;
        delete legacyItem.gross_margin_pct;
        delete legacyItem.discount_type;
        delete legacyItem.discount_value;
        return legacyItem;
      });
      const legacyResult = await db
        .from('pos_order_items')
        .insert(legacyItems)
        .select('id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price, total_amount');
      insertedItems = legacyResult.data as PrintJobItem[] | null;
      itemsErr = legacyResult.error;
    }
    if (itemsErr) {
      console.error('Open bill items error:', itemsErr);
      // Best-effort: we leave the order without items rather than crashing
      return NextResponse.json({ success: false, error: itemsErr.message }, { status: 500 });
    }

    const printJobs = buildKitchenPrintJobs(orderData, (insertedItems || orderItems) as PrintJobItem[]);
    if (printJobs.length > 0) {
      const { error: printJobError } = await db
        .from('pos_print_jobs')
        .insert(printJobs);

      if (printJobError && printJobError.code !== '42P01' && printJobError.code !== 'PGRST205') {
        console.warn('Open bill print jobs warning:', printJobError.message);
      }
    }

    await db.from('pos_order_status_history').insert({
      order_id: orderData.id,
      from_status: null,
      to_status: 'pending',
      changed_by: cashier_id || sessionUserId,
      notes: 'Open bill created from cashier',
    });

    return NextResponse.json({
      success: true,
      data: orderData,
      message: 'Open bill created successfully',
    }, { status: 201 });
  } catch (error: unknown) {
    console.error('Open bill error:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
