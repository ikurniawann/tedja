import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { getPosSession } from "@/lib/api/auth";

async function orderHasUnpaidSplits(
  db: ReturnType<typeof createPgClient>,
  orderId: string
) {
  const { data, error } = await db
    .from("pos_order_splits")
    .select("id, status")
    .eq("order_id", orderId)
    .neq("status", "cancelled");

  if (error) throw error;
  return (data || []).some(
    (split) => String(split.status || "").toLowerCase() !== "paid"
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return Response.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { target_order_id, supervisor_pin } = body as {
      target_order_id?: string;
      supervisor_pin?: string;
    };
    const { id: sourceOrderId } = await params;

    if (!target_order_id) {
      return Response.json(
        { success: false, error: "Target order required" },
        { status: 400 }
      );
    }

    if (sourceOrderId === target_order_id) {
      return Response.json(
        { success: false, error: "Cannot merge order with itself" },
        { status: 400 }
      );
    }

    const db = createPgClient();

    // PIN optional when authenticated POS session; validate when provided.
    if (supervisor_pin != null && String(supervisor_pin).trim() !== "") {
      const { data: supervisor } = await db
        .from("users")
        .select("id, full_name, role")
        .eq("role", "pos_supervisor")
        .eq("pos_pin", String(supervisor_pin))
        .single();

      if (!supervisor) {
        return Response.json(
          { success: false, error: "Invalid supervisor PIN" },
          { status: 403 }
        );
      }
    }

    const { data: source } = await db
      .from("pos_orders")
      .select("id, status, table_id, subtotal, discount_amount, tax_amount")
      .eq("id", sourceOrderId)
      .single();

    const { data: target } = await db
      .from("pos_orders")
      .select(
        "id, status, subtotal, discount_amount, tax_amount, merged_from_orders"
      )
      .eq("id", target_order_id)
      .single();

    if (!source || !target) {
      return Response.json(
        { success: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const blockedStatuses = ["completed", "cancelled", "voided", "merged"];
    if (blockedStatuses.includes(source.status as string)) {
      return Response.json(
        { success: false, error: "Source order cannot be merged" },
        { status: 400 }
      );
    }
    if (blockedStatuses.includes(target.status as string)) {
      return Response.json(
        { success: false, error: "Target order cannot receive merge" },
        { status: 400 }
      );
    }

    if (await orderHasUnpaidSplits(db, sourceOrderId)) {
      return Response.json(
        {
          success: false,
          error: "Finish or cancel unpaid splits before merging",
        },
        { status: 400 }
      );
    }
    if (await orderHasUnpaidSplits(db, target_order_id)) {
      return Response.json(
        {
          success: false,
          error: "Target bill has unpaid splits",
        },
        { status: 400 }
      );
    }

    const { error: moveErr } = await db
      .from("pos_order_items")
      .update({ order_id: target_order_id })
      .eq("order_id", sourceOrderId);

    if (moveErr) throw moveErr;

    const { data: itemsAgg } = await db
      .from("pos_order_items")
      .select("subtotal, total_amount")
      .eq("order_id", target_order_id);

    const newSubtotal = (itemsAgg || []).reduce(
      (s, it) => s + (it.subtotal || 0),
      0
    );
    const newTotal = (itemsAgg || []).reduce(
      (s, it) => s + (it.total_amount || 0),
      0
    );

    const { error: updTargetErr } = await db
      .from("pos_orders")
      .update({
        subtotal: newSubtotal,
        total_amount: newTotal,
        discount_amount:
          (target.discount_amount || 0) + (source.discount_amount || 0),
        tax_amount: (target.tax_amount || 0) + (source.tax_amount || 0),
        merged_from_orders: [
          ...((target.merged_from_orders as string[]) || []),
          sourceOrderId,
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", target_order_id);

    if (updTargetErr) throw updTargetErr;

    await db
      .from("pos_orders")
      .update({
        status: "merged",
        merged_to_order_id: target_order_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sourceOrderId);

    if (source.table_id) {
      const { data: otherActive } = await db
        .from("pos_orders")
        .select("id")
        .eq("table_id", source.table_id)
        .in("status", [
          "pending",
          "confirmed",
          "preparing",
          "ready",
          "served",
        ])
        .neq("id", sourceOrderId)
        .limit(1)
        .maybeSingle();

      if (!otherActive) {
        await db
          .from("pos_tables")
          .update({
            status: "available",
            updated_at: new Date().toISOString(),
          })
          .eq("id", source.table_id);
      }
    }

    return Response.json({
      success: true,
      data: {
        source_order_id: sourceOrderId,
        target_order_id: target_order_id,
        message: "Orders merged successfully",
      },
    });
  } catch (error: unknown) {
    console.error("Merge error:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Merge failed",
      },
      { status: 500 }
    );
  }
}
