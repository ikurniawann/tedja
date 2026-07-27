import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { getCrmDefaultVenue, requireCrmCampaign } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { normalizePhoneDigits } from "@/lib/member-portal/otp";
import { query } from "@/lib/db";

// EPIC-033 — daftar opt-out marketing (kelola manual MVP; keyword STOP
// otomatis = Fase D). TERPISAH dari wa_consent portal.

export async function GET() {
  const { error } = await requireCrmCampaign();
  if (error) return error;
  try {
    const venue = await getCrmDefaultVenue(createPgClient());
    const rows = await query(
      `SELECT id, phone, source, note, created_at
       FROM crm.crm_marketing_optouts
       WHERE branch_id = $1
       ORDER BY created_at DESC LIMIT 500`,
      [venue.branchId]
    );
    return successResponse(rows);
  } catch (err) {
    console.error("[crm-campaign] optouts list error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar opt-out" },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  phone: z.string().trim().min(8).max(25),
  note: z.string().trim().max(300).optional(),
});

export async function POST(request: NextRequest) {
  const { error, user } = await requireCrmCampaign();
  if (error) return error;
  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed" },
        { status: 400 }
      );
    }
    const phone = normalizePhoneDigits(parsed.data.phone);
    if (!phone) {
      return NextResponse.json(
        { success: false, error: "Nomor tidak valid" },
        { status: 400 }
      );
    }
    const venue = await getCrmDefaultVenue(createPgClient());
    const rows = await query<{ id: string }>(
      `INSERT INTO crm.crm_marketing_optouts
         (company_id, branch_id, phone, source, note, created_by)
       VALUES ($1, $2, $3, 'manual', $4, $5)
       ON CONFLICT (branch_id, phone) DO UPDATE SET
         note = COALESCE(EXCLUDED.note, crm_marketing_optouts.note)
       RETURNING id`,
      [venue.companyId, venue.branchId, phone, parsed.data.note ?? null, user.id]
    );
    return successResponse(rows[0], "Nomor masuk daftar opt-out");
  } catch (err) {
    console.error("[crm-campaign] optout add error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menambah opt-out" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { error } = await requireCrmCampaign();
  if (error) return error;
  try {
    const id = request.nextUrl.searchParams.get("id") ?? "";
    if (!z.string().uuid().safeParse(id).success) {
      return NextResponse.json(
        { success: false, error: "id tidak valid" },
        { status: 400 }
      );
    }
    const venue = await getCrmDefaultVenue(createPgClient());
    const rows = await query<{ id: string }>(
      `DELETE FROM crm.crm_marketing_optouts
       WHERE id = $1 AND branch_id = $2 RETURNING id`,
      [id, venue.branchId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Tidak ditemukan" },
        { status: 404 }
      );
    }
    return successResponse({ id }, "Nomor dikeluarkan dari opt-out");
  } catch (err) {
    console.error("[crm-campaign] optout delete error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menghapus opt-out" },
      { status: 500 }
    );
  }
}
