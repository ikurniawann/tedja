import { NextRequest, NextResponse } from "next/server";
import { noContentResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { requireFinanceRole } from "@/lib/finance/server";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";

/**
 * EPIC-025 — hapus (soft) catatan pembayaran dari modul Finance:
 * koreksi salah catat, jejak tetap (deleted_at + deleted_by).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { error, user } = await requireFinanceRole();
  if (error) return error;

  try {
    const { paymentId } = await params;
    const payment = await queryOne<{ id: string; deal_id: string }>(
      `SELECT id, deal_id FROM crm.crm_sales_deal_payments
       WHERE id = $1 AND deleted_at IS NULL`,
      [paymentId]
    );
    if (!payment) {
      return NextResponse.json(
        { success: false, error: "Catatan pembayaran tidak ditemukan" },
        { status: 404 }
      );
    }
    const { deal, forbidden } = await findAccessibleDeal(payment.deal_id, user);
    if (forbidden || !deal) {
      return NextResponse.json(
        { success: false, error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    await queryOne(
      `UPDATE crm.crm_sales_deal_payments
       SET deleted_at = now(), deleted_by = $2, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [paymentId, user.id]
    );
    return noContentResponse();
  } catch (err) {
    console.error("[finance] delete payment error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus catatan pembayaran" },
      { status: 500 }
    );
  }
}
