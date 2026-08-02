import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { restoreMerchandiseStockForOrder } from '@/lib/pos/merchandise-stock';

/** PATCH /api/pos/orders/{id}/status
 *  Body: { status: string, reason?: string }
 *  Updates order status + logs to pos_order_status_history
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const orderId = resolvedParams.id;
  if (!orderId) {
    return NextResponse.json({ success: false, error: 'Order ID required' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const { status, reason } = body;

  const validStatuses = ['pending','confirmed','preparing','ready','served','completed','cancelled'];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
  }

  const db = createPgClient();

  const { data: currentOrder, error: fetchError } = await db
    .from('pos_orders')
    .select('status')
    .eq('id', orderId)
    .single();

  if (fetchError || !currentOrder) {
    return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const updateData: Record<string, string> = { status, updated_at: now };
  if (status === 'confirmed') updateData.confirmed_at = now;
  if (status === 'ready') updateData.completed_at = now;
  if (status === 'served' || status === 'completed') updateData.served_at = now;

  let { error: updateError } = await db
    .from('pos_orders')
    .update(updateData)
    .eq('id', orderId);

  if (updateError?.code === '42703' || updateError?.code === 'PGRST204') {
    const legacyUpdate = { ...updateData };
    delete legacyUpdate.served_at;

    const legacyResult = await db
      .from('pos_orders')
      .update(legacyUpdate)
      .eq('id', orderId);

    updateError = legacyResult.error;
  }

  if (updateError) {
    console.error('Status update error:', updateError);
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }

  // EPIC-039 Fase A — order batal → kembalikan stok merchandise yang sudah
  // terpotong (idempoten via flag inventory_deducted per baris item).
  if (status === 'cancelled') {
    await restoreMerchandiseStockForOrder(db, orderId);
  }

  const kitchenStatusMap: Record<string, string> = {
    pending: 'pending',
    confirmed: 'pending',
    preparing: 'preparing',
    ready: 'ready',
    served: 'served',
    completed: 'served',
    cancelled: 'cancelled',
  };

  const kitchenStatus = kitchenStatusMap[status];
  if (kitchenStatus) {
    const itemUpdate: Record<string, string | null> = {
      kitchen_status: kitchenStatus,
      updated_at: now,
    };

    if (status === 'preparing') itemUpdate.kitchen_started_at = now;
    if (status === 'ready') itemUpdate.kitchen_ready_at = now;
    if (status === 'served' || status === 'completed') itemUpdate.served_at = now;

    const { error: itemStatusError } = await db
      .from('pos_order_items')
      .update(itemUpdate)
      .eq('order_id', orderId);

    if (itemStatusError && itemStatusError.code !== '42703' && itemStatusError.code !== 'PGRST204') {
      console.warn('Order item kitchen status update warning:', itemStatusError.message);
    }
  }

  await db.from('pos_order_status_history').insert({
    order_id: orderId,
    from_status: currentOrder.status,
    to_status: status,
    reason: reason || `Status updated to ${status}`,
    changed_at: now,
  });

  return NextResponse.json({ success: true, data: { order_id: orderId, status, kitchen_status: kitchenStatus } });
}
