import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { BAND_STATUSES, requireTicketingContext } from "@/lib/ticketing/server";

const updateBandSchema = z.object({
  label: z.string().trim().max(60).optional().nullable(),
  status: z.enum(BAND_STATUSES).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateBandSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // `dipakai` di-set oleh alur visit (Fase B) dan `karyawan` oleh
    // pairing staff pass (Fase E) — dari registry, petugas hanya
    // menandai tersedia/hilang/rusak.
    if (body.status === "dipakai" || body.status === "karyawan") {
      return NextResponse.json(
        {
          success: false,
          error:
            body.status === "dipakai"
              ? "Status 'dipakai' diatur otomatis oleh registrasi kunjungan"
              : "Status 'karyawan' diatur otomatis oleh pairing Gelang Karyawan",
        },
        { status: 400 }
      );
    }

    const sets: string[] = ["updated_at = now()"];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (body.label !== undefined) add("label", body.label || null);
    if (body.status !== undefined) add("status", body.status);

    values.push(id, ctx.branchId, ctx.companyId);
    const rows = await query(
      `UPDATE ticketing.ticket_bands SET ${sets.join(", ")}
       WHERE id = $${values.length - 2}
         AND branch_id = $${values.length - 1}
         AND company_id = $${values.length}
         AND status NOT IN ('dipakai', 'karyawan')
       RETURNING id, nfc_uid, label, status, created_at, updated_at`,
      values
    );
    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Gelang tidak ditemukan, sedang dipakai kunjungan aktif, atau dipegang karyawan (cabut pairing dulu)",
        },
        { status: 404 }
      );
    }
    return successResponse(rows[0], "Gelang diperbarui");
  } catch (err) {
    console.error("[ticketing] update band error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memperbarui gelang" },
      { status: 500 }
    );
  }
}
