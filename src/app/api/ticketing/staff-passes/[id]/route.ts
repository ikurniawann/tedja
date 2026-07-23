import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";

/**
 * Cabut pairing gelang karyawan: pass nonaktif (riwayat dipertahankan),
 * gelang kembali 'tersedia' sebagai stok kunjungan.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    await withTransaction(async (client) => {
      const passResult = await client.query<{ band_id: string }>(
        `UPDATE ticketing.ticket_staff_passes
         SET is_active = false, revoked_at = now(), revoked_by = $4,
             updated_at = now()
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
           AND is_active = true
         RETURNING band_id`,
        [id, ctx.branchId, ctx.companyId, ctx.user.id]
      );
      if (passResult.rows.length === 0) {
        throw Object.assign(new Error("Pairing tidak ditemukan / sudah dicabut"), {
          statusCode: 404,
        });
      }
      await client.query(
        `UPDATE ticketing.ticket_bands
         SET status = 'tersedia', updated_at = now()
         WHERE id = $1 AND status = 'karyawan'`,
        [passResult.rows[0].band_id]
      );
    });
    return successResponse({ id }, "Pairing dicabut — gelang kembali tersedia");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] revoke staff pass error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mencabut pairing" },
      { status: 500 }
    );
  }
}
