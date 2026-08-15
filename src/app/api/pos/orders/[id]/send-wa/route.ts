import { NextRequest, NextResponse } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { sendWhatsAppText } from "@/lib/whatsapp";
import {
  buildOrderReceiptMessage,
  normalizeWaPhone,
} from "@/lib/pos/receipt-wa";

/**
 * POST /api/pos/orders/[id]/send-wa — kirim struk digital via WhatsApp.
 *
 * Body: { phone?: string } — untuk non-member, kasir mengetik nomornya;
 * untuk member, nomor diambil dari profil pelanggan pada order.
 *
 * Isi struk dimuat ULANG dari database, bukan dipercaya dari klien — struk
 * adalah pernyataan resmi tentang uang, dan payload klien bisa saja basi
 * (mis. harga berubah oleh promo yang dievaluasi server).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const { id: orderId } = await params;
    const body = (await request.json().catch(() => ({}))) as { phone?: string };
    const db = createPgClient();

    const { data: order } = await db
      .from("pos_orders")
      .select(
        `id, order_number, ordered_at, total_amount, discount_amount,
         payment_method, amount_paid, payment_status,
         customer:pos_customers(name, phone),
         items:pos_order_items(product_name, quantity, total_amount)`
      )
      .eq("id", orderId)
      .single();

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Order tidak ditemukan" },
        { status: 404 }
      );
    }
    if (order.payment_status !== "paid") {
      return NextResponse.json(
        { success: false, error: "Struk hanya bisa dikirim untuk order yang sudah lunas" },
        { status: 400 }
      );
    }

    const customer = order.customer as { name?: string | null; phone?: string | null } | null;
    const phone = normalizeWaPhone(body.phone ?? customer?.phone);
    if (!phone) {
      return NextResponse.json(
        { success: false, error: "Nomor WA tidak valid — periksa kembali" },
        { status: 400 }
      );
    }

    const outlet = await queryOne<{ name: string }>(
      "SELECT name FROM configuration.companies ORDER BY created_at LIMIT 1"
    );

    const items = ((order.items as Array<{
      product_name: string;
      quantity: number | string;
      total_amount: number | string;
    }>) ?? []).map((item) => ({
      name: item.product_name,
      quantity: Number(item.quantity) || 1,
      total: Number(item.total_amount) || 0,
    }));

    const total = Number(order.total_amount) || 0;
    const paid = Number(order.amount_paid) || 0;
    const message = buildOrderReceiptMessage({
      outletName: outlet?.name ?? "Kasir",
      orderNumber: String(order.order_number ?? orderId),
      orderedAt: String(order.ordered_at ?? new Date().toISOString()),
      items,
      total,
      paymentMethod: String(order.payment_method ?? "cash"),
      change: Math.max(0, paid - total),
      discountAmount: Number(order.discount_amount) || 0,
      customerName: customer?.name ?? null,
    });

    const result = await sendWhatsAppText(
      { target: phone, message },
      { messageType: "notification", sentByUserId: sessionUserId }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.reason ?? "Gagal mengirim WA" },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, data: { phone } });
  } catch (error) {
    console.error("[pos:send-wa] gagal:", error);
    return NextResponse.json(
      { success: false, error: "Gagal mengirim struk" },
      { status: 500 }
    );
  }
}
