import { NextRequest, NextResponse } from "next/server";
import { noContentResponse } from "@/lib/api/auth";
import { queryOne } from "@/lib/db";
import { findAccessibleDeal } from "@/lib/sales-funnel/access";
import { requireSalesFunnelRole } from "@/lib/sales-funnel/server";

/**
 * Hapus (soft) satu catatan pembayaran — koreksi salah catat. Jejaknya
 * tetap di tabel (deleted_at + deleted_by), progress dihitung ulang dari
 * baris hidup saja.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const { error, user } = await requireSalesFunnelRole();
  if (error) return error;

  try {
    const { id, paymentId } = await params;
    const { deal, forbidden } = await findAccessibleDeal(id, user);
    if (forbidden || !deal) {
      return NextResponse.json(
        { success: false, error: forbidden ? "Insufficient permissions" : "Deal tidak ditemukan" },
        { status: forbidden ? 403 : 404 }
      );
    }

    const deleted = await queryOne<{ id: string }>(
      `UPDATE crm.crm_sales_deal_payments
       SET deleted_at = now(), deleted_by = $3, updated_at = now()
       WHERE id = $1 AND deal_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [paymentId, id, user.id]
    );
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Catatan pembayaran tidak ditemukan" },
        { status: 404 }
      );
    }
    return noContentResponse();
  } catch (err) {
    console.error("[sales-funnel] delete payment error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus catatan pembayaran" },
      { status: 500 }
    );
  }
}
