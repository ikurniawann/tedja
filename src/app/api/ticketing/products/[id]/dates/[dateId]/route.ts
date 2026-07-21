import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

/** Hapus rentang kalender ticket (master murni — boleh hard delete). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; dateId: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id, dateId } = await params;
    const rows = await query<{ id: string }>(
      `DELETE FROM ticketing.ticket_product_dates
       WHERE id = $1 AND ticket_product_id = $2
         AND branch_id = $3 AND company_id = $4
       RETURNING id`,
      [dateId, id, ctx.branchId, ctx.companyId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Rentang tanggal tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse({ id: dateId }, "Rentang tanggal dihapus");
  } catch (err) {
    console.error("[ticketing] delete product date error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus rentang tanggal" },
      { status: 500 }
    );
  }
}
