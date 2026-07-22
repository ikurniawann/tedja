import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, queryOne, withTransaction } from "@/lib/db";
import {
  PAYMENT_MODES,
  RE_ENTRY_POLICIES,
  requireTicketingContext,
} from "@/lib/ticketing/server";

interface SettingsRow {
  id: string;
  re_entry_policy: string;
  default_credit_limit: string;
  default_payment_mode: string;
  booking_slug: string | null;
  updated_at: string;
}

const SETTINGS_COLUMNS = `id, re_entry_policy, default_credit_limit,
  default_payment_mode, booking_slug, updated_at`;

/**
 * Bootstrap sekali jalan saat venue pertama kali membuka Ticketing:
 * baris settings + kanal default (walk-in/website). Ticket dibuat owner
 * lewat Master Ticket (revisi 2026-07-21) — tidak ada seed jenis tiket.
 * Idempotent via ON CONFLICT.
 */
async function ensureDefaults(companyId: string, branchId: string, userId: string) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ticketing.ticket_settings (company_id, branch_id, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (branch_id) DO NOTHING`,
      [companyId, branchId, userId]
    );
    await client.query(
      `INSERT INTO ticketing.ticket_channels
         (company_id, branch_id, code, name, is_online, sort_order, created_by)
       VALUES
         ($1, $2, 'walk-in', 'Walk-in (Loket)', false, 10, $3),
         ($1, $2, 'website', 'Website Booking', true, 20, $3)
       ON CONFLICT (branch_id, code) DO NOTHING`,
      [companyId, branchId, userId]
    );
  });
}

export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    await ensureDefaults(ctx.companyId, ctx.branchId, ctx.user.id);
    const settings = await queryOne<SettingsRow>(
      `SELECT ${SETTINGS_COLUMNS} FROM ticketing.ticket_settings
       WHERE branch_id = $1 AND company_id = $2`,
      [ctx.branchId, ctx.companyId]
    );
    return successResponse(settings);
  } catch (err) {
    console.error("[ticketing] get settings error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat pengaturan ticketing" },
      { status: 500 }
    );
  }
}

// Segmen statis yang hidup berdampingan dgn [slug] di /booking/* dan
// /api/public/booking/* — dipakai venue = rute ambigu.
const RESERVED_BOOKING_SLUGS = new Set(["status", "webhook", "catalog", "api"]);

const updateSettingsSchema = z.object({
  re_entry_policy: z.enum(RE_ENTRY_POLICIES).optional(),
  default_credit_limit: z.number().min(0).max(1_000_000_000).optional(),
  default_payment_mode: z.enum(PAYMENT_MODES).optional(),
  // Slug URL booking publik /booking/[slug] — null = booking online mati.
  // Kata yang menabrak segmen statis route /booking/* dilarang.
  booking_slug: z
    .string()
    .regex(/^[a-z0-9-]{2,50}$/, "Slug: huruf kecil, angka, tanda hubung (2-50)")
    .refine((s) => !RESERVED_BOOKING_SLUGS.has(s), {
      message: "Slug ini kata terpakai sistem — pilih slug lain",
    })
    .nullable()
    .optional(),
});

export async function PUT(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = updateSettingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const sets: string[] = ["updated_at = now()", "updated_by = $1"];
    const params: unknown[] = [ctx.user.id];
    const add = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (body.re_entry_policy !== undefined) add("re_entry_policy", body.re_entry_policy);
    if (body.default_credit_limit !== undefined) {
      add("default_credit_limit", body.default_credit_limit);
    }
    if (body.default_payment_mode !== undefined) {
      add("default_payment_mode", body.default_payment_mode);
    }
    if (body.booking_slug !== undefined) add("booking_slug", body.booking_slug);

    params.push(ctx.branchId, ctx.companyId);
    const rows = await query<SettingsRow>(
      `UPDATE ticketing.ticket_settings SET ${sets.join(", ")}
       WHERE branch_id = $${params.length - 1} AND company_id = $${params.length}
       RETURNING ${SETTINGS_COLUMNS}`,
      params
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Pengaturan belum dibootstrap — buka halaman Ticketing dulu" },
        { status: 404 }
      );
    }
    return successResponse(rows[0], "Pengaturan tersimpan");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Slug booking sudah dipakai venue lain" },
        { status: 409 }
      );
    }
    console.error("[ticketing] update settings error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan pengaturan ticketing" },
      { status: 500 }
    );
  }
}
