import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { queryOne, withTransaction } from "@/lib/db";
import {
  RESERVATION_STATUS_LABELS, canTransition, folioBalance, type ReservationStatus,
} from "@/lib/resort/reservation";
import { requireResortContext } from "@/lib/resort/server";

/**
 * POST /api/resort/reservations/[id]/status
 *   { action: 'konfirmasi' | 'check-in' | 'check-out' | 'batal' | 'no-show',
 *     assignments?: [{ reservation_room_id, room_id }], reason?, force? }
 *
 * Check-in wajib menetapkan unit kamar untuk setiap baris reservasi; check-out
 * menolak bila folio masih ada saldo (kecuali `force` dengan alasan) dan
 * mengubah status kamar menjadi 'kotor' untuk housekeeping.
 */
const ACTION_TO_STATUS: Record<string, ReservationStatus> = {
  konfirmasi: "terkonfirmasi",
  "check-in": "check-in",
  "check-out": "check-out",
  batal: "dibatalkan",
  "no-show": "no-show",
};

const schema = z.object({
  action: z.enum(["konfirmasi", "check-in", "check-out", "batal", "no-show"]),
  assignments: z.array(z.object({ reservation_room_id: z.string().uuid(), room_id: z.string().uuid() })).max(20).optional(),
  reason: z.string().trim().max(500).optional().nullable(),
  force: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireResortContext("update");
    const { id } = await params;
    const body = await validateBody(request, schema);
    const next = ACTION_TO_STATUS[body.action];

    const actor = await queryOne<{ full_name: string | null }>(
      `SELECT full_name FROM configuration.users WHERE id = $1`, [ctx.user.id]
    );
    const actorName = actor?.full_name?.trim() || "Front Office";

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; status: ReservationStatus; reservation_code: string; guest_name: string }>(
        `SELECT id, status, reservation_code, guest_name FROM resort.reservations
         WHERE id = $1 AND branch_id = $2 FOR UPDATE`,
        [id, ctx.branchId]
      );
      const reservation = rows[0];
      if (!reservation) return { error: "Reservasi tidak ditemukan", status: 404 as const };
      if (!canTransition(reservation.status, next)) {
        return {
          error: `Tidak bisa mengubah status dari "${RESERVATION_STATUS_LABELS[reservation.status]}" ke "${RESERVATION_STATUS_LABELS[next]}"`,
          status: 409 as const,
        };
      }

      if (next === "check-in") {
        for (const a of body.assignments ?? []) {
          const room = await client.query<{ id: string; name: string }>(
            `SELECT id, name FROM resort.rooms WHERE id = $1 AND branch_id = $2 AND is_active AND status <> 'ditutup'`,
            [a.room_id, ctx.branchId]
          );
          if (!room.rows[0]) return { error: "Kamar tujuan tidak tersedia", status: 400 as const };
          // Kamar tidak boleh dipakai reservasi lain yang sedang menginap
          const busy = await client.query(
            `SELECT 1 FROM resort.reservation_rooms rr JOIN resort.reservations r ON r.id = rr.reservation_id
             WHERE rr.room_id = $1 AND r.status = 'check-in' AND r.id <> $2 LIMIT 1`,
            [a.room_id, id]
          );
          if (busy.rows[0]) return { error: `Kamar ${room.rows[0].name} sedang ditempati tamu lain`, status: 409 as const };
          await client.query(
            `UPDATE resort.reservation_rooms SET room_id = $2, room_name = $3
             WHERE id = $1 AND reservation_id = $4`,
            [a.reservation_room_id, a.room_id, room.rows[0].name, id]
          );
        }
        const unassigned = await client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NULL`,
          [id]
        );
        if (Number(unassigned.rows[0]?.c) > 0) {
          return { error: "Tetapkan unit kamar untuk semua baris reservasi sebelum check-in", status: 400 as const };
        }
      }

      if (next === "check-out") {
        const folio = await client.query<{ direction: "debit" | "kredit"; amount: string }>(
          `SELECT direction, amount FROM resort.folio_charges WHERE reservation_id = $1`, [id]
        );
        const balance = folioBalance(folio.rows);
        if (balance > 0 && !body.force) {
          return { error: `Folio masih bersaldo Rp ${Math.round(balance).toLocaleString("id-ID")} — lunasi dulu atau centang lanjutkan dengan catatan`, status: 409 as const };
        }
        await client.query(
          `UPDATE resort.rooms SET status = 'kotor', updated_at = now()
           WHERE id IN (SELECT room_id FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NOT NULL)`,
          [id]
        );
      }

      if (next === "dibatalkan" || next === "no-show") {
        await client.query(
          `UPDATE resort.reservations SET cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
          [id, body.reason ?? null]
        );
      }

      const stamp =
        next === "check-in" ? ", checked_in_at = now()"
        : next === "check-out" ? ", checked_out_at = now()"
        : next === "terkonfirmasi" ? ", paid_at = COALESCE(paid_at, now())" : "";
      await client.query(
        `UPDATE resort.reservations SET status = $2${stamp}, updated_at = now() WHERE id = $1`,
        [id, next]
      );
      if (next === "check-out" && body.force && body.reason) {
        // Check-out dengan sisa tagihan → alasan disimpan sebagai catatan reservasi
        await client.query(
          `UPDATE resort.reservations
           SET notes = COALESCE(notes || E'\n', '') || $2, updated_at = now() WHERE id = $1`,
          [id, `Check-out dengan saldo terbuka (${actorName}): ${body.reason}`]
        );
      }
      return { data: { id, status: next, code: reservation.reservation_code, guest: reservation.guest_name } };
    });

    if ("error" in result) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    const label = RESERVATION_STATUS_LABELS[result.data.status];
    return NextResponse.json({
      success: true,
      data: result.data,
      message: `${result.data.code} — ${result.data.guest}: ${label}`,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] reservation status:", error);
    return NextResponse.json({ success: false, error: "Gagal mengubah status reservasi" }, { status: 500 });
  }
}
