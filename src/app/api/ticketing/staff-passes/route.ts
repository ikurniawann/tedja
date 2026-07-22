import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import {
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// Fase E (ops) — Gelang Karyawan: pairing gelang NFC ↔ karyawan HRIS utk
// akses gate gratis. Pengaturan hidup di modul Ticketing (bukan HRIS):
// gelang aset venue, wewenang di ops. Tabel hanya menunjuk hris.employees.

interface StaffPassRow {
  id: string;
  band_id: string;
  nfc_uid: string;
  band_label: string | null;
  employee_id: string;
  full_name: string;
  nip: string | null;
  employee_active: boolean;
  created_at: string;
}

/** Daftar pass AKTIF venue ini (+ pencarian nama/NIP/UID). */
export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const params: unknown[] = [ctx.branchId, ctx.companyId];
    let where = `sp.branch_id = $1 AND sp.company_id = $2 AND sp.is_active = true`;
    if (q) {
      params.push(`%${q}%`, `%${normalizeNfcUid(q) || q}%`);
      where += ` AND (e.full_name ILIKE $3 OR e.nip ILIKE $3 OR b.nfc_uid ILIKE $4)`;
    }

    const rows = await query<StaffPassRow>(
      `SELECT sp.id, sp.band_id, b.nfc_uid, b.label AS band_label,
              sp.employee_id, e.full_name, e.nip,
              e.is_active AS employee_active, sp.created_at
       FROM ticketing.ticket_staff_passes sp
       JOIN ticketing.ticket_bands b ON b.id = sp.band_id
       JOIN hris.employees e ON e.id = sp.employee_id
       WHERE ${where}
       ORDER BY e.full_name
       LIMIT 200`,
      params
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[ticketing] list staff passes error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat gelang karyawan" },
      { status: 500 }
    );
  }
}

const pairSchema = z.object({
  nfc_uid: z.string().trim().min(1).max(80),
  employee_id: z.string().uuid(),
});

/** Pasangkan gelang 'tersedia' ke karyawan aktif → status 'karyawan'. */
export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = pairSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const uid = normalizeNfcUid(parsed.data.nfc_uid);
    if (!isValidNfcUid(uid)) {
      return NextResponse.json(
        { success: false, error: "UID gelang tidak valid — scan ulang" },
        { status: 400 }
      );
    }

    const result = await withTransaction(async (client) => {
      const bandResult = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM ticketing.ticket_bands
         WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3
         FOR UPDATE`,
        [ctx.branchId, ctx.companyId, uid]
      );
      const band = bandResult.rows[0];
      if (!band) {
        throw Object.assign(
          new Error(`Gelang ${uid} belum terdaftar di registry — daftarkan dulu`),
          { statusCode: 400 }
        );
      }
      if (band.status !== "tersedia") {
        throw Object.assign(
          new Error(`Gelang berstatus "${band.status}" — hanya gelang tersedia yang bisa dipasangkan`),
          { statusCode: 409 }
        );
      }

      const employeeResult = await client.query<{ full_name: string }>(
        `SELECT full_name FROM hris.employees
         WHERE id = $1 AND is_active = true`,
        [parsed.data.employee_id]
      );
      if (employeeResult.rows.length === 0) {
        throw Object.assign(new Error("Karyawan tidak ditemukan / nonaktif"), {
          statusCode: 400,
        });
      }

      const existing = await client.query(
        `SELECT 1 FROM ticketing.ticket_staff_passes
         WHERE branch_id = $1 AND employee_id = $2 AND is_active = true`,
        [ctx.branchId, parsed.data.employee_id]
      );
      if (existing.rows.length > 0) {
        throw Object.assign(
          new Error("Karyawan ini sudah memegang gelang — cabut dulu yang lama"),
          { statusCode: 409 }
        );
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ticketing.ticket_staff_passes
           (company_id, branch_id, band_id, employee_id, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [ctx.companyId, ctx.branchId, band.id, parsed.data.employee_id, ctx.user.id]
      );
      await client.query(
        `UPDATE ticketing.ticket_bands
         SET status = 'karyawan', updated_at = now() WHERE id = $1`,
        [band.id]
      );
      return { id: inserted.rows[0].id, employee: employeeResult.rows[0].full_name };
    });

    return successResponse(
      { id: result.id },
      `Gelang dipasangkan ke ${result.employee}`
    );
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    // Race unique index pass aktif per gelang
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Gelang/karyawan sudah terpasang — muat ulang daftar" },
        { status: 409 }
      );
    }
    console.error("[ticketing] pair staff pass error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memasangkan gelang karyawan" },
      { status: 500 }
    );
  }
}
