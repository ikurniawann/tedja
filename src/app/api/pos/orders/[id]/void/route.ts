import { NextRequest } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from '@/lib/api/auth';
import { buildVoidBesarMessage, voidDedupKey } from '@/lib/wa/notifications-messages';
import { fireOwnerNotification, getWaNotifConfig } from '@/lib/wa/notifications-sender';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { reason, supervisor_pin } = body;
    const orderId = params.id;

    if (!reason || !supervisor_pin) {
      return Response.json({ success: false, error: 'Reason and supervisor PIN required' }, { status: 400 });
    }

    const db = createPgClient();

    // 1. Validate supervisor PIN
    const { data: supervisor } = await db
      .from('users')
      .select('id, full_name, role')
      .eq('role', 'pos_supervisor')
      .eq('pos_pin', String(supervisor_pin))
      .single();

    if (!supervisor) {
      return Response.json({ success: false, error: 'PIN supervisor tidak valid' }, { status: 403 });
    }

    // 2. Fetch order
    const { data: order, error: orderErr } = await db
      .from('pos_orders')
      .select('id, status, order_number, total_amount')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      return Response.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    if (order.status === 'voided') {
      return Response.json({ success: false, error: 'Order already voided' }, { status: 400 });
    }
    if (order.status === 'completed') {
      return Response.json({ success: false, error: 'Cannot void completed order' }, { status: 400 });
    }
    if (order.status === 'merged') {
      return Response.json({ success: false, error: 'Cannot void merged order' }, { status: 400 });
    }

    // 3. Void the order
    const { error: updErr } = await db
      .from('pos_orders')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: supervisor.id,
        void_reason: reason.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updErr) throw updErr;

    // 4. Cancel any pending splits
    await db
      .from('pos_order_splits')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('order_id', orderId)
      .eq('status', 'pending');

    // 5. EPIC-020: void bernilai besar → WA owner (event, bukan polling).
    // Tembak-dan-lupakan: notifikasi tidak boleh menggagalkan void-nya;
    // dedup by order id — retry request tidak mengirim WA dua kali.
    try {
      const total = Number(order.total_amount) || 0;
      const config = await getWaNotifConfig();
      if (total >= config.voidThresholdRp) {
        fireOwnerNotification({
          type: 'voidBesar',
          dedupKey: voidDedupKey(orderId),
          message: buildVoidBesarMessage({
            orderNumber: String(order.order_number ?? orderId.slice(0, 8)),
            total,
            reason: String(reason).trim(),
            supervisorName: supervisor.full_name ?? 'supervisor',
          }),
          config,
        });
      }
    } catch (notifError) {
      console.error('[wa-notif] gagal menyiapkan notif void:', notifError);
    }

    return Response.json({
      success: true,
      data: { order_id: orderId, message: 'Order voided successfully' },
    });
  } catch (error: unknown) {
    console.error('Void error:', error);
    const message = error instanceof Error ? error.message : 'Void gagal diproses';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
