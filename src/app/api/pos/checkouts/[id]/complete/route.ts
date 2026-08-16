import { NextRequest, NextResponse } from "next/server";
import { getPosSession } from "@/lib/api/auth";
import {
  MixedCheckoutError,
  completeMixedCheckout,
} from "@/lib/pos/create-mixed-checkout";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

type CompleteCheckoutBody = {
  payment_method?: string;
  amount_paid?: number | string;
  payment_method_code?: string;
  payment_method_name?: string;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const checkoutId = String(id || "").trim();
    if (!checkoutId) {
      return NextResponse.json({ success: false, error: "Checkout tidak valid" }, { status: 400 });
    }

    let body: CompleteCheckoutBody = {};
    try {
      body = (await request.json()) as CompleteCheckoutBody;
    } catch {
      body = {};
    }

    const amountPaid =
      body.amount_paid === undefined || body.amount_paid === null
        ? null
        : Number(body.amount_paid);

    const result = await completeMixedCheckout(checkoutId, {
      paymentMethod: body.payment_method,
      amountPaid,
      paymentMethodCode: body.payment_method_code,
      paymentMethodName: body.payment_method_name,
    });
    return NextResponse.json({
      success: true,
      data: { order_ids: result.orderIds },
    });
  } catch (error: unknown) {
    if (error instanceof MixedCheckoutError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status }
      );
    }
    console.error("[pos] complete checkout error:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
