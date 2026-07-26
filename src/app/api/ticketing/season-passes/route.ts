import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import {
  TICKETING_OPERATOR_ROLES,
  requireTicketingContext,
  normalizeNfcUid,
  isValidNfcUid,
} from "@/lib/ticketing/server";
import { generateAccessToken, todayInJakarta } from "@/lib/ticketing/booking";
import { addMonthsIso, generatePassCode } from "@/lib/ticketing/season-pass";

interface PassListRow {
  id: string;
  pass_code: string;
  holder_name: string;
  holder_phone: string | null;
  product_name: string;
  status: string;
  entry_policy: string;
  valid_from: string | null;
  valid_until: string | null;
  visit_quota_total: number | null;
  visit_quota_used: number;
  band_uid: string | null;
  unit_price: string;
  created_at: string;
}

/** Daftar pass terbit (venue scoped). */
export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const params: unknown[] = [ctx.branchId, ctx.companyId];
    let where = "sp.branch_id = $1 AND sp.company_id = $2";
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (sp.pass_code ILIKE $${params.length} OR sp.holder_name ILIKE $${params.length} OR sp.holder_phone ILIKE $${params.length})`;
    }

    const rows = await query<PassListRow>(
      `SELECT sp.id, sp.pass_code, sp.holder_name, sp.holder_phone,
              tp.name AS product_name, sp.status, sp.entry_policy,
              sp.valid_from, sp.valid_until, sp.visit_quota_total,
              sp.visit_quota_used, sp.band_uid, sp.unit_price, sp.created_at
       FROM ticketing.ticket_season_passes sp
       JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
       WHERE ${where}
       ORDER BY sp.created_at DESC
       LIMIT 200`,
      params
    );

    return successResponse(
      rows.map((r) => ({
        ...r,
        unit_price: Number(r.unit_price),
      }))
    );
  } catch (err) {
    console.error("[ticketing] list season passes error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar pass" },
      { status: 500 }
    );
  }
}

const issueSchema = z.object({
  ticket_product_id: z.string().uuid(),
  holder_name: z.string().trim().min(2).max(120),
  holder_phone: z.string().trim().max(25).optional().nullable(),
  band_uid: z.string().trim().max(64).optional().nullable(),
});

/** Terbitkan pass di loket (dibayar di tempat → langsung active). */
export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const parsed = issueSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // Produk pass + config (harus Active season_pass milik venue ini)
    const productRows = await query<{
      validity_months: number;
      entry_policy: string;
      visit_quota: number | null;
      unit_price: string | null;
    }>(
      `SELECT pc.validity_months, pc.entry_policy, pc.visit_quota,
              COALESCE(v.price_regular, tp.base_price) AS unit_price
       FROM ticketing.ticket_products tp
       JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = tp.id
       LEFT JOIN LATERAL (
         SELECT price_regular FROM ticketing.ticket_product_variants
         WHERE ticket_product_id = tp.id AND is_active = true
         ORDER BY sort_order LIMIT 1
       ) v ON true
       WHERE tp.id = $1 AND tp.branch_id = $2 AND tp.company_id = $3
         AND tp.product_kind = 'season_pass' AND tp.status = 'active'`,
      [body.ticket_product_id, ctx.branchId, ctx.companyId]
    );
    const config = productRows[0];
    if (!config) {
      return NextResponse.json(
        { success: false, error: "Produk Season Pass tidak ditemukan atau belum aktif" },
        { status: 400 }
      );
    }

    // Gelang NFC opsional: bila diisi, harus sudah terdaftar di venue
    let bandId: string | null = null;
    let bandUid: string | null = null;
    if (body.band_uid) {
      const uid = normalizeNfcUid(body.band_uid);
      if (!isValidNfcUid(uid)) {
        return NextResponse.json(
          { success: false, error: "UID gelang tidak valid" },
          { status: 400 }
        );
      }
      const bandRows = await query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_bands
         WHERE nfc_uid = $1 AND branch_id = $2 AND company_id = $3`,
        [uid, ctx.branchId, ctx.companyId]
      );
      if (!bandRows[0]) {
        return NextResponse.json(
          { success: false, error: "Gelang belum terdaftar — daftarkan dulu di Pengaturan" },
          { status: 400 }
        );
      }
      bandId = bandRows[0].id;
      bandUid = uid;
    }

    const today = todayInJakarta();
    const validUntil = addMonthsIso(today, config.validity_months);
    const accessToken = generateAccessToken();
    const quotaTotal =
      config.entry_policy === "limited_visits" ? config.visit_quota : null;

    const pass = await withTransaction(async (client) => {
      const passCode = await generatePassCode(client, ctx.branchId, today);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO ticketing.ticket_season_passes
           (company_id, branch_id, ticket_product_id, pass_code, access_token,
            holder_name, holder_phone, valid_from, valid_until, status,
            entry_policy, visit_quota_total, visit_quota_used, band_id, band_uid,
            source, unit_price, paid_at, activated_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,0,$12,$13,
                 'loket',$14, now(), now(), $15)
         RETURNING id`,
        [
          ctx.companyId,
          ctx.branchId,
          body.ticket_product_id,
          passCode,
          accessToken,
          body.holder_name,
          body.holder_phone || null,
          today,
          validUntil,
          config.entry_policy,
          quotaTotal,
          bandId,
          bandUid,
          Number(config.unit_price ?? 0),
          ctx.user.id,
        ]
      );
      return { id: inserted.rows[0].id, passCode };
    });

    return successResponse(
      {
        id: pass.id,
        pass_code: pass.passCode,
        access_token: accessToken,
        holder_name: body.holder_name,
        valid_from: today,
        valid_until: validUntil,
        entry_policy: config.entry_policy,
        visit_quota_total: quotaTotal,
        unit_price: Number(config.unit_price ?? 0),
        band_uid: bandUid,
      },
      `Pass ${pass.passCode} diterbitkan`
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Tabrakan kode pass — coba terbitkan sekali lagi" },
        { status: 409 }
      );
    }
    console.error("[ticketing] issue season pass error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menerbitkan pass" },
      { status: 500 }
    );
  }
}
