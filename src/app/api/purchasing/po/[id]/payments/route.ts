import { NextRequest } from "next/server";
import { ApiError, requireApiRole } from "@/lib/api/auth";

const PAYMENT_ROLES = ["admin", "super_admin", "purchasing_admin", "finance_staff"] as const;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Deprecated: vendor payment write path moved to Accounting AP Payment.
 * Dual-write still happens inside `recordApPayment` for PO outstanding views.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiRole([...PAYMENT_ROLES]);
    await params;
    return Response.json(
      {
        success: false,
        message:
          "Pembayaran vendor dipindah ke Accounting → Accounts Payable → Payment. Gunakan /dashboard/accounting/accounts-payable/payments",
        redirect: "/dashboard/accounting/accounts-payable/payments",
      },
      { status: 410 }
    );
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    return Response.json(
      { success: false, message: getErrorMessage(error, "Failed") },
      { status: 500 }
    );
  }
}
