import { NextRequest, NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// Keputusan owner 2026-07-22: gelang hilang TANPA denda — tagihan tetap
// ditagih by data (kasir mencari visit via nama / no. WA di loket, lalu
// settlement rombongan seperti biasa; charge gelang hilang sudah ada di
// ledger). Yang dilakukan di sini hanya memblokir gelangnya:
// visit_band → 'hilang' (gate tap & F&B "NFC Tab" otomatis menolak karena
// keduanya mensyaratkan status 'aktif') dan registry band → 'hilang'
// (tidak bisa dipakai registrasi baru). Tidak bisa di-undo dari sini —
// bila gelang ketemu lagi, setelah settlement petugas mengubah statusnya
// ke 'tersedia' di registry gelang.

class LostError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; bandId: string }> }
) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-band-lost:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak aksi — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const { id, bandId } = await params;

    const result = await withTransaction(async (client) => {
      // Kunci visit — serialisasi dgn gate tap / settle / charge F&B
      const visitResult = await client.query<{ status: string }>(
        `SELECT status FROM ticketing.ticket_visits
         WHERE id = $1 AND branch_id = $2 AND company_id = $3
         FOR UPDATE`,
        [id, ctx.branchId, ctx.companyId]
      );
      const visit = visitResult.rows[0];
      if (!visit) throw new LostError("Kunjungan tidak ditemukan", 404);
      if (visit.status !== "open") {
        throw new LostError("Kunjungan sudah ditutup", 409);
      }

      const vbResult = await client.query<{
        id: string;
        band_id: string;
        status: string;
        nfc_uid: string;
      }>(
        `SELECT vb.id, vb.band_id, vb.status, b.nfc_uid
         FROM ticketing.ticket_visit_bands vb
         JOIN ticketing.ticket_bands b ON b.id = vb.band_id
         WHERE vb.id = $1 AND vb.visit_id = $2
         FOR UPDATE OF vb, b`,
        [bandId, id]
      );
      const visitBand = vbResult.rows[0];
      if (!visitBand) {
        throw new LostError("Gelang tidak ada di kunjungan ini", 404);
      }
      if (visitBand.status !== "aktif") {
        throw new LostError(
          "Gelang sudah di-settle / sudah ditandai hilang",
          409
        );
      }

      await client.query(
        `UPDATE ticketing.ticket_visit_bands
         SET status = 'hilang', updated_at = now() WHERE id = $1`,
        [visitBand.id]
      );
      // Registry ikut 'hilang' — gelang yang ditemukan orang lain tidak
      // bisa dipakai registrasi/redeem (syarat 'tersedia' existing)
      await client.query(
        `UPDATE ticketing.ticket_bands
         SET status = 'hilang', updated_at = now()
         WHERE id = $1 AND status = 'dipakai'`,
        [visitBand.band_id]
      );

      return { visit_band_id: visitBand.id, nfc_uid: visitBand.nfc_uid };
    });

    return successResponse(
      result,
      "Gelang ditandai hilang — tagihannya tetap tertagih saat settlement"
    );
  } catch (err) {
    if (err instanceof LostError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.statusCode }
      );
    }
    console.error("[ticketing] mark band lost error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menandai gelang hilang" },
      { status: 500 }
    );
  }
}
