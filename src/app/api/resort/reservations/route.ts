import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, validateBody } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import { quoteStay, type RoomTypeRate } from "@/lib/resort/rates";
import {
  RESERVATION_SOURCES, generateReservationCode, reservationSummary, validateStayDates,
} from "@/lib/resort/reservation";
import { loadBookedRooms, loadRoomTypes, loadSeasons, requireResortContext } from "@/lib/resort/server";

/**
 * GET  /api/resort/reservations?status&from&to&search — daftar reservasi.
 * POST /api/resort/reservations — buat reservasi: hitung tarif per malam
 *      (snapshot), cek ketersediaan per tipe, dan catat tagihan kamar ke folio.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireResortContext();
    const sp = request.nextUrl.searchParams;
    const values: unknown[] = [ctx.branchId];
    const where: string[] = ["r.branch_id = $1"];
    const status = sp.get("status");
    if (status && status !== "all") { values.push(status); where.push(`r.status = $${values.length}`); }
    const from = sp.get("from");
    const to = sp.get("to");
    if (from && to) {
      values.push(from, to);
      // Reservasi yang bersinggungan dengan rentang tanggal
      where.push(`r.check_in < $${values.length}::date + 1 AND r.check_out > $${values.length - 1}::date`);
    }
    const search = (sp.get("search") || "").trim();
    if (search) {
      values.push(`%${search}%`);
      where.push(`(r.guest_name ILIKE $${values.length} OR r.guest_phone ILIKE $${values.length} OR r.reservation_code ILIKE $${values.length})`);
    }
    const rows = await query(
      `SELECT r.id, r.reservation_code, r.guest_name, r.guest_phone, r.guest_email,
              r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights, r.adults, r.children,
              r.status, r.source, r.total::float8 AS total, r.notes, r.created_by_name, r.created_at,
              r.checked_in_at, r.checked_out_at,
              (SELECT COUNT(*) FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id)::int AS room_count,
              (SELECT string_agg(DISTINCT rr.room_type_name, ', ') FROM resort.reservation_rooms rr WHERE rr.reservation_id = r.id) AS room_types,
              COALESCE((SELECT SUM(CASE WHEN f.direction = 'debit' THEN f.amount ELSE -f.amount END)
                        FROM resort.folio_charges f WHERE f.reservation_id = r.id), 0)::float8 AS balance
       FROM resort.reservations r
       WHERE ${where.join(" AND ")}
       ORDER BY r.check_in DESC, r.created_at DESC
       LIMIT 300`,
      values
    );
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] reservations GET:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

const schema = z.object({
  guest_name: z.string().trim().min(2).max(150),
  guest_phone: z.string().trim().min(6).max(30),
  guest_email: z.string().trim().email().max(150).optional().nullable(),
  check_in: z.string(),
  check_out: z.string(),
  adults: z.number().int().min(1).max(50).default(2),
  children: z.number().int().min(0).max(50).default(0),
  source: z.enum(RESERVATION_SOURCES).default("walk-in"),
  status: z.enum(["menunggu-bayar", "terkonfirmasi"]).default("menunggu-bayar"),
  discount_amount: z.number().min(0).default(0),
  notes: z.string().trim().max(1000).optional().nullable(),
  special_request: z.string().trim().max(1000).optional().nullable(),
  rooms: z.array(z.object({
    room_type_id: z.string().uuid(),
    qty: z.number().int().min(1).max(20).default(1),
    extra_bed: z.number().int().min(0).max(10).default(0),
    guest_name: z.string().trim().max(150).optional().nullable(),
    room_id: z.string().uuid().optional().nullable(),
  })).min(1).max(20),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireResortContext("create");
    const body = await validateBody(request, schema);
    const invalid = validateStayDates(body.check_in, body.check_out);
    if (invalid) throw ApiError.badRequest(invalid);

    const [types, seasons, booked] = await Promise.all([
      loadRoomTypes(ctx.branchId),
      loadSeasons(ctx.branchId, body.check_in, body.check_out),
      loadBookedRooms(ctx.branchId, body.check_in, body.check_out),
    ]);
    const typeById = new Map(types.map((t) => [String(t.id), t]));
    const unitCounts = await query<{ room_type_id: string; total: number }>(
      `SELECT room_type_id, COUNT(*)::int AS total FROM resort.rooms
       WHERE branch_id = $1 AND is_active AND status <> 'ditutup' GROUP BY room_type_id`,
      [ctx.branchId]
    );
    const totalByType = new Map(unitCounts.map((u) => [u.room_type_id, u.total]));

    // Validasi ketersediaan per tipe: unit aktif − yang sudah dipesan ≥ permintaan
    const lines: Array<{ typeId: string; typeName: string; extraBed: number; guestName: string | null; roomId: string | null; quote: ReturnType<typeof quoteStay> }> = [];
    for (const req of body.rooms) {
      const type = typeById.get(req.room_type_id);
      if (!type) throw ApiError.notFound("Tipe kamar tidak ditemukan atau tidak aktif");
      const already = booked.filter((b) => b.room_type_id === req.room_type_id).length;
      const requested = body.rooms.filter((r) => r.room_type_id === req.room_type_id).reduce((s, r) => s + r.qty, 0);
      const total = totalByType.get(req.room_type_id) ?? 0;
      if (already + requested > total) {
        throw ApiError.conflict(`${type.name}: sisa ${Math.max(0, total - already)} kamar untuk tanggal tersebut, diminta ${requested}`);
      }
      if (req.extra_bed > Number(type.extra_bed_capacity ?? 0)) {
        throw ApiError.badRequest(`${type.name}: maksimal ${type.extra_bed_capacity} extra bed per kamar`);
      }
      const quote = quoteStay({ type: type as unknown as RoomTypeRate, checkIn: body.check_in, checkOut: body.check_out, extraBed: req.extra_bed, seasons });
      for (let i = 0; i < req.qty; i += 1) {
        lines.push({
          typeId: req.room_type_id, typeName: String(type.name), extraBed: req.extra_bed,
          guestName: req.guest_name ?? null, roomId: i === 0 ? req.room_id ?? null : null, quote,
        });
      }
    }

    const roomTotal = lines.reduce((s, l) => s + l.quote.room_subtotal, 0);
    const extraTotal = lines.reduce((s, l) => s + l.quote.extra_bed_total, 0);
    const total = Math.max(0, roomTotal + extraTotal - body.discount_amount);
    const nights = lines[0]?.quote.nights ?? 0;

    const actor = await queryOne<{ full_name: string | null }>(
      `SELECT full_name FROM configuration.users WHERE id = $1`, [ctx.user.id]
    );
    const actorName = actor?.full_name?.trim() || "Front Office";

    const result = await withTransaction(async (client) => {
      let reservationId = "";
      let code = "";
      for (let attempt = 0; attempt < 5 && !reservationId; attempt += 1) {
        code = generateReservationCode();
        try {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO resort.reservations
               (company_id, branch_id, reservation_code, access_token, guest_name, guest_phone, guest_email,
                check_in, check_out, nights, adults, children, status, source, room_total, extra_total,
                discount_amount, total, notes, special_request, created_by, created_by_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
             RETURNING id`,
            [ctx.companyId, ctx.branchId, code, crypto.randomBytes(24).toString("hex"),
             body.guest_name, body.guest_phone, body.guest_email ?? null, body.check_in, body.check_out,
             nights, body.adults, body.children, body.status, body.source, roomTotal, extraTotal,
             body.discount_amount, total, body.notes ?? null, body.special_request ?? null, ctx.user.id, actorName]
          );
          reservationId = rows[0].id;
        } catch (err) {
          // 23505 = kode reservasi bentrok → coba kode lain
          if ((err as { code?: string }).code !== "23505") throw err;
        }
      }
      if (!reservationId) throw new Error("Gagal membuat kode reservasi unik");

      for (const line of lines) {
        const roomName = line.roomId
          ? (await client.query<{ name: string }>(`SELECT name FROM resort.rooms WHERE id = $1`, [line.roomId])).rows[0]?.name ?? null
          : null;
        await client.query(
          `INSERT INTO resort.reservation_rooms
             (company_id, branch_id, reservation_id, room_type_id, room_id, room_type_name, room_name,
              nightly_rate, nights, extra_bed, subtotal, guest_name, rate_breakdown)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [ctx.companyId, ctx.branchId, reservationId, line.typeId, line.roomId, line.typeName, roomName,
           line.quote.nights > 0 ? Math.round(line.quote.room_subtotal / line.quote.nights) : 0,
           line.quote.nights, line.extraBed, line.quote.subtotal, line.guestName ?? body.guest_name,
           JSON.stringify(line.quote.breakdown)]
        );
      }

      // Folio: tagihan kamar (+ extra bed, − diskon) langsung tercatat
      const addCharge = (type: string, direction: string, description: string, amount: number) =>
        client.query(
          `INSERT INTO resort.folio_charges
             (company_id, branch_id, reservation_id, charge_type, direction, description, amount, created_by, created_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ctx.companyId, ctx.branchId, reservationId, type, direction, description, amount, ctx.user.id, actorName]
        );
      if (roomTotal > 0) await addCharge("kamar", "debit", `Kamar ${lines.length} unit × ${nights} malam`, roomTotal);
      if (extraTotal > 0) await addCharge("extra-bed", "debit", `Extra bed × ${nights} malam`, extraTotal);
      if (body.discount_amount > 0) await addCharge("diskon", "kredit", "Diskon reservasi", body.discount_amount);

      return { id: reservationId, code };
    });

    return NextResponse.json({
      success: true,
      data: { id: result.id, reservation_code: result.code, nights, total },
      message: reservationSummary({ code: result.code, guest: body.guest_name, nights, rooms: lines.length, total }),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("[resort] reservations POST:", error);
    return NextResponse.json({ success: false, error: "Gagal membuat reservasi" }, { status: 500 });
  }
}
