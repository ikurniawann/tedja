import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPgClient } from "@/lib/pg/create-client";
import { awardCrmXpForPosOrder, syncPosCustomerOrderStats } from "@/lib/crm/loyalty-engine";

const orderItemSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string().trim().min(1).max(180),
  product_sku: z.string().trim().max(80).optional(),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  selected_variant: z.string().trim().max(120).optional(),
  variant_price_adjustment: z.number().default(0),
  xp: z.number().int().nonnegative().default(0),
  station: z.enum(["Kitchen", "Bar", "Bakery", "Dessert", "Merchandise", "Photobooth"]).default("Kitchen"),
});

const createOrderSchema = z.object({
  table_code: z.string().trim().min(1).max(80),
  table_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  guest_name: z.string().trim().max(160).optional(),
  payment_method: z.enum(["qris", "ark_coin", "va", "cashier"]),
  items: z.array(orderItemSchema).min(1),
  notes: z.string().trim().max(500).optional(),
});

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveTableId(
  db: import("@/lib/pg/types").DbClient,
  tableCode: string,
  tableId?: string | null
) {
  if (tableId) return tableId;
  if (isUuid(tableCode)) return tableCode;

  const { data, error } = await db
    .from("pos_tables")
    .select("id")
    .or(`table_number.eq.${tableCode},qr_code.eq.${tableCode}`)
    .maybeSingle();

  if (error) {
    console.warn("Table order table lookup warning:", error.message);
    return null;
  }

  return (data as { id?: string } | null)?.id ?? null;
}

async function resolveCashierId() {
  return "00000000-0000-0000-0000-000000000001";
}

function normalizeStation(station: string) {
  return station.trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const payload = createOrderSchema.parse(await request.json());
    const db = createPgClient();
    const tableId = await resolveTableId(db, payload.table_code, payload.table_id);
    const cashierId = await resolveCashierId();
    const subtotal = payload.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const tax = Math.round(subtotal * 0.1);
    const total = subtotal + tax;
    const selfPaid = payload.payment_method === "ark_coin";

    if (payload.payment_method === "ark_coin") {
      if (!payload.customer_id) {
        return NextResponse.json({ success: false, error: "ARK Coin membutuhkan member/customer" }, { status: 400 });
      }

      // Atomic deduct via RPC: locks the customer row (FOR UPDATE), rejects an
      // insufficient balance inside the same transaction, and logs the wallet
      // transaction — eliminates the read-then-write race / double-spend.
      // NOTE: deduction still precedes order creation, so a later order-insert
      // failure leaves the balance debited; the full fix is a single
      // create-order-with-payment RPC (tracked as a follow-up).
      const { error: balanceError } = await db.rpc("update_ark_coin_balance", {
        p_customer_id: payload.customer_id,
        p_amount: -total,
        p_type: "payment",
        p_order_id: null,
        p_notes: `Self-service order table ${payload.table_code}`,
      });

      if (balanceError) {
        const insufficient = balanceError.message?.includes("Insufficient");
        return NextResponse.json(
          { success: false, error: insufficient ? "Saldo ARK Coin tidak cukup" : "Gagal memproses ARK Coin" },
          { status: 400 }
        );
      }
    }

    const { data: orderNumData, error: orderNumError } = await db.rpc("generate_order_number");
    if (orderNumError) throw orderNumError;

    const orderNumber = typeof orderNumData === "string" ? orderNumData : String(orderNumData);
    const paymentStatus = selfPaid ? "paid" : "unpaid";
    const orderStatus = selfPaid ? "confirmed" : "pending";
    const paymentMethod = selfPaid ? "ark_coin" : null;

    const { data: order, error: orderError } = await db
      .from("pos_orders")
      .insert({
        order_number: orderNumber,
        order_type: "dine_in",
        status: orderStatus,
        payment_status: paymentStatus,
        customer_id: payload.customer_id || null,
        cashier_id: cashierId,
        table_id: tableId,
        subtotal,
        discount_amount: 0,
        tax_amount: tax,
        service_charge_amount: 0,
        total_amount: total,
        payment_method: paymentMethod,
        amount_paid: selfPaid ? total : 0,
        ark_coins_used: selfPaid ? total : 0,
        notes: payload.notes || `Self-service order table ${payload.table_code}`,
        special_requests: `Self-service table ${payload.table_code}; payment=${payload.payment_method}`,
        ordered_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderError || !order) {
      throw orderError ?? new Error("Gagal membuat order");
    }

    const orderId = (order as { id: string }).id;
    const orderItems = payload.items.map((item) => ({
      order_id: orderId,
      product_id: item.product_id,
      product_name: item.product_name,
      product_sku: String(item.product_sku || item.product_id).slice(0, 50),
      variants: item.selected_variant ? [{ name: item.selected_variant }] : [],
      modifiers: [],
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.unit_price * item.quantity,
      total_amount: item.unit_price * item.quantity,
      kitchen_notes: `${item.station} · Self-service`,
      station: normalizeStation(item.station),
      kitchen_status: "pending",
      xp_earned: item.xp * item.quantity,
      inventory_deducted: false,
    }));

    let { error: itemsError } = await db.from("pos_order_items").insert(orderItems);
    if (itemsError?.code === "42703" || itemsError?.code === "PGRST204") {
      const legacyItems = orderItems.map((item) => {
        const legacyItem = { ...item } as Partial<typeof item>;
        delete legacyItem.station;
        delete legacyItem.kitchen_status;
        return legacyItem;
      });
      const legacyResult = await db.from("pos_order_items").insert(legacyItems);
      itemsError = legacyResult.error;
    }
    if (itemsError) throw itemsError;

    await db.from("pos_order_status_history").insert({
      order_id: orderId,
      from_status: null,
      to_status: orderStatus,
      changed_by: cashierId,
      notes: `Created from table self-service (${payload.payment_method})`,
    });

    if (selfPaid && payload.customer_id) {
      await syncPosCustomerOrderStats(db, payload.customer_id, total);
    }

    const crmXp = selfPaid
      ? await awardCrmXpForPosOrder(db, {
          orderId,
          customerId: payload.customer_id || null,
          totalAmount: total,
          items: orderItems,
          outletId: null,
          paymentMethod: payload.payment_method,
        })
      : { status: "skipped", xpAwarded: 0, reason: "payment_unpaid" };

    return NextResponse.json({
      success: true,
      data: {
        ...(order as Record<string, unknown>),
        items: orderItems,
        table_code: payload.table_code,
        table_resolved: Boolean(tableId),
        payment_flow: payload.payment_method,
        kitchen_routing: "Order is available to KDS pending/confirmed queue",
        crm_xp: crmXp,
      },
    }, { status: 201 });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    console.error("Table order create error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal membuat table order" },
      { status }
    );
  }
}
