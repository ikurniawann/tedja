import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { checkProductPrivileges } from "@/lib/crm/product-privilege";
import { createPgClient } from "@/lib/pg/create-client";
import { canSellMixedStall } from "@/lib/pos/central-cashier";
import {
  MixedCheckoutError,
  createMixedCheckout,
  guardMixedCheckoutCart,
  type MixedCheckoutItem,
} from "@/lib/pos/create-mixed-checkout";
import {
  loadCentralCashierGate,
  loadPosProductWarehouseIds,
} from "@/lib/pos/pos-sell-stall-server";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function resolveCashierId(): Promise<string> {
  return "00000000-0000-0000-0000-000000000001";
}

type CheckoutBody = {
  order_type?: string;
  customer_id?: string;
  cashier_id?: string;
  server_id?: string;
  table_id?: string;
  guest_count?: number | string;
  items?: Array<Record<string, unknown>>;
  discount_amount?: number | string;
  discount_reason?: string;
  tax_amount?: number | string;
  service_charge_amount?: number | string;
  other_charges_amount?: number | string;
  charges_breakdown?: unknown;
  total_amount?: number | string;
  payment_method?: string;
  payment_method_code?: string;
  payment_method_name?: string;
  payment_status?: string;
  amount_paid?: number | string;
  notes?: string;
  special_requests?: string;
  ark_coins_used?: number | string;
  promo_code?: string;
  splits?: unknown[];
  branch_id?: string;
  shift_id?: string;
};

export async function POST(request: NextRequest) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CheckoutBody;
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Items and total amount are required" },
        { status: 400 }
      );
    }

    const productIds = items.map((item) => String(item.product_id || ""));
    const warehouseByProduct = await loadPosProductWarehouseIds(productIds);
    const scope = await getApiUserScope();
    const gate = await loadCentralCashierGate({
      userId: sessionUserId,
      role: scope?.role ?? null,
    });
    const mixedGuard = guardMixedCheckoutCart({
      productIds,
      warehouseByProduct,
      canSellMixed: canSellMixedStall({
        hasCentralMenu: gate.hasCentralMenu,
        canCentralCheckout: gate.canCentralCheckout,
        activeMode: gate.activeMode,
      }),
      hasSplits: Array.isArray(body.splits) && body.splits.length > 0,
      promoCode: body.promo_code,
    });
    if (!mixedGuard.ok) {
      return NextResponse.json({ success: false, error: mixedGuard.message }, { status: 400 });
    }
    if (!mixedGuard.createCheckout) {
      return NextResponse.json(
        { success: false, error: "Checkout multi-stall membutuhkan item dari minimal 2 stall" },
        { status: 400 }
      );
    }

    const db = createPgClient();
    const privilege = await checkProductPrivileges(db, productIds, body.customer_id);
    if (!privilege.allowed) {
      return NextResponse.json({ success: false, error: privilege.message }, { status: 403 });
    }

    const result = await createMixedCheckout({
      items: items as MixedCheckoutItem[],
      warehouseByProduct,
      orderType: body.order_type,
      customerId: body.customer_id,
      cashierId: body.cashier_id || (await resolveCashierId()),
      serverId: body.server_id,
      tableId: body.table_id,
      guestCount: body.guest_count,
      discountAmount: body.discount_amount,
      discountReason: body.discount_reason,
      promoCode: body.promo_code,
      taxAmount: body.tax_amount,
      serviceChargeAmount: body.service_charge_amount,
      otherChargesAmount: body.other_charges_amount,
      chargesBreakdown: body.charges_breakdown,
      totalAmount: body.total_amount,
      paymentMethod: body.payment_method,
      paymentMethodCode: body.payment_method_code,
      paymentMethodName: body.payment_method_name,
      paymentStatus: body.payment_status,
      amountPaid: body.amount_paid,
      arkCoinsUsed: body.ark_coins_used,
      notes: body.notes,
      specialRequests: body.special_requests,
      companyId: scope?.companyId,
      branchId: body.branch_id || scope?.branchId,
      shiftId: body.shift_id,
      sessionUserId,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          checkout_id: result.checkoutId,
          checkout_number: result.checkoutNumber,
          queue_number: result.queueNumber,
          order_ids: result.orderIds,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof MixedCheckoutError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("[pos] create checkout error:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
