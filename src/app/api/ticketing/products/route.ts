import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";
import { RE_ENTRY_POLICIES } from "@/lib/ticketing/server";

interface ProductListRow {
  id: string;
  code: string;
  name: string;
  category_name: string | null;
  status: "draft" | "active";
  product_kind: "single" | "bundle" | "season_pass";
  base_price: string;
  cogs: string;
  has_gate: boolean;
  thumbnail_url: string | null;
  variant_count: string;
  distributed_channels: string[] | null;
  updated_at: string;
}

/** Daftar ticket (Master Ticket). */
export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
    const params: unknown[] = [ctx.branchId, ctx.companyId];
    let where = "tp.branch_id = $1 AND tp.company_id = $2";
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (tp.name ILIKE $${params.length} OR tp.code ILIKE $${params.length})`;
    }

    const rows = await query<ProductListRow>(
      `SELECT tp.id, tp.code, tp.name, c.name AS category_name, tp.status,
              tp.product_kind, tp.base_price, tp.cogs, tp.has_gate,
              tp.thumbnail_url, tp.updated_at,
              (SELECT COUNT(*) FROM ticketing.ticket_product_variants pv
               WHERE pv.ticket_product_id = tp.id AND pv.is_active) AS variant_count,
              (SELECT array_agg(ch.code) FROM ticketing.ticket_product_channels pc
               JOIN ticketing.ticket_channels ch ON ch.id = pc.channel_id
               WHERE pc.ticket_product_id = tp.id AND pc.is_distributed)
                AS distributed_channels
       FROM ticketing.ticket_products tp
       LEFT JOIN ticketing.ticket_categories c ON c.id = tp.category_id
       WHERE ${where}
       ORDER BY tp.created_at DESC`,
      params
    );
    return successResponse(
      rows.map((row) => ({
        ...row,
        base_price: Number(row.base_price),
        cogs: Number(row.cogs),
        variant_count: Number(row.variant_count),
        distributed_channels: row.distributed_channels ?? [],
      }))
    );
  } catch (err) {
    console.error("[ticketing] list products error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar ticket" },
      { status: 500 }
    );
  }
}

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(150),
  // satuan (Adult/Child) atau paket bundling (satu varian "Paket" +
  // komposisi diatur setelah dibuat) — Fase P; season_pass — EPIC-028
  product_kind: z.enum(["single", "bundle", "season_pass"]).default("single"),
  // EPIC-028 — konfigurasi season pass (hanya dipakai bila kind=season_pass)
  validity_months: z.number().int().min(1).max(120).default(12),
  entry_policy: z
    .enum(["once_per_day", "unlimited", "limited_visits"])
    .default("once_per_day"),
  visit_quota: z.number().int().min(1).max(1000).optional().nullable(),
  // Benefit member: diskon POS utk pemegang pass aktif (0 = tanpa benefit)
  member_discount_percent: z.number().min(0).max(100).default(0),
  // Keputusan owner 2026-07-22: tiket satuan boleh Adult/Child ATAU satu
  // varian "Umum" yang berlaku semua umur — dipilih saat pembuatan
  variant_preset: z.enum(["adult-child", "umum"]).default("adult-child"),
  // kategori: pilih existing ATAU nama baru (auto-add)
  category_id: z.string().uuid().optional().nullable(),
  category_name: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["draft", "active"]).default("draft"),
  base_price: z.number().min(0).max(1_000_000_000).default(0),
  // HPP per ticket → laporan omzet kotor vs bersih
  cogs: z.number().min(0).max(1_000_000_000).default(0),
  // Ticket ber-gate divalidasi di gate; tanpa gate = reader NFC keliling
  has_gate: z.boolean().default(true),
  description: z.string().trim().max(2000).optional().nullable(),
  re_entry_policy: z.enum(RE_ENTRY_POLICIES).optional(),
});

/**
 * Buat ticket baru: kode auto TKT-#### per venue, varian default
 * Adult/Child (harga kosong — wajib diisi sebelum jual), distribusi
 * default walk-in ON / website OFF (diatur ulang di Channel Manager).
 */
export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const parsed = createProductSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    // Paket baru wajib Draft: belum ada komposisi, belum boleh dijual
    if (body.product_kind === "bundle" && body.status === "active") {
      return NextResponse.json(
        {
          success: false,
          error: "Paket baru wajib berstatus Draft — lengkapi komposisi dulu",
        },
        { status: 400 }
      );
    }

    // EPIC-028 — pass punch-card WAJIB kuota; policy lain kuota diabaikan
    if (
      body.product_kind === "season_pass" &&
      body.entry_policy === "limited_visits" &&
      (!body.visit_quota || body.visit_quota <= 0)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Kuota kunjungan wajib diisi untuk pass jenis punch-card (jatah kunjungan)",
        },
        { status: 400 }
      );
    }

    const result = await withTransaction(async (client) => {
      // Default venue utk kebijakan re-entry ticket baru
      const settingsResult = await client.query<{ re_entry_policy: string }>(
        `SELECT re_entry_policy FROM ticketing.ticket_settings
         WHERE branch_id = $1 AND company_id = $2`,
        [ctx.branchId, ctx.companyId]
      );
      const reEntry =
        body.re_entry_policy ??
        settingsResult.rows[0]?.re_entry_policy ??
        "sekali-masuk";

      // Kategori: auto-add bila dikirim sebagai nama; bila dikirim sebagai
      // id, WAJIB milik venue ini (anti-IDOR lintas tenant)
      let categoryId = body.category_id ?? null;
      if (categoryId) {
        const owned = await client.query(
          `SELECT 1 FROM ticketing.ticket_categories
           WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
          [categoryId, ctx.branchId, ctx.companyId]
        );
        if (owned.rows.length === 0) {
          throw Object.assign(new Error("Kategori tidak dikenal"), {
            statusCode: 400,
          });
        }
      }
      if (!categoryId && body.category_name) {
        const catResult = await client.query<{ id: string }>(
          `INSERT INTO ticketing.ticket_categories
             (company_id, branch_id, name, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (branch_id, lower(name)) DO UPDATE SET updated_at = now()
           RETURNING id`,
          [ctx.companyId, ctx.branchId, body.category_name, ctx.user.id]
        );
        categoryId = catResult.rows[0].id;
      }

      // Kode auto per venue (admin action jarang — MAX cukup, unique
      // constraint jadi jaring pengaman race)
      const codeResult = await client.query<{ next: string }>(
        `SELECT COALESCE(MAX(NULLIF(substring(code from 5), '')::int), 0) + 1 AS next
         FROM ticketing.ticket_products
         WHERE branch_id = $1 AND code ~ '^TKT-[0-9]+$'`,
        [ctx.branchId]
      );
      const code = `TKT-${String(Number(codeResult.rows[0].next)).padStart(4, "0")}`;

      const productResult = await client.query<{ id: string }>(
        `INSERT INTO ticketing.ticket_products
           (company_id, branch_id, code, name, category_id, status,
            product_kind, base_price, cogs, has_gate, description,
            re_entry_policy, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [
          ctx.companyId,
          ctx.branchId,
          code,
          body.name,
          categoryId,
          body.status,
          body.product_kind,
          body.base_price,
          body.cogs,
          body.has_gate,
          body.description || null,
          reEntry,
          ctx.user.id,
        ]
      );
      const productId = productResult.rows[0].id;

      // Varian default (harga kosong = wajib dilengkapi sebelum jual):
      // satuan → Adult/Child atau satu varian "Umum" (preset pilihan
      // owner); paket → SATU varian "Paket" (harga paket)
      if (body.product_kind === "bundle") {
        await client.query(
          `INSERT INTO ticketing.ticket_product_variants
             (company_id, branch_id, ticket_product_id, code, name, sort_order)
           VALUES ($1, $2, $3, 'paket', 'Paket', 10)`,
          [ctx.companyId, ctx.branchId, productId]
        );
      } else if (
        body.variant_preset === "umum" ||
        body.product_kind === "season_pass"
      ) {
        // season_pass: satu varian "Umum" penampung harga pass
        await client.query(
          `INSERT INTO ticketing.ticket_product_variants
             (company_id, branch_id, ticket_product_id, code, name, sort_order)
           VALUES ($1, $2, $3, 'umum', 'Umum', 10)`,
          [ctx.companyId, ctx.branchId, productId]
        );
      } else {
        await client.query(
          `INSERT INTO ticketing.ticket_product_variants
             (company_id, branch_id, ticket_product_id, code, name, sort_order)
           VALUES
             ($1, $2, $3, 'adult', 'Adult', 10),
             ($1, $2, $3, 'child', 'Child', 20)`,
          [ctx.companyId, ctx.branchId, productId]
        );
      }

      // EPIC-028 — konfigurasi season pass (1:1 dengan produk)
      if (body.product_kind === "season_pass") {
        await client.query(
          `INSERT INTO ticketing.ticket_pass_configs
             (company_id, branch_id, ticket_product_id, validity_months,
              entry_policy, visit_quota, member_discount_percent, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            ctx.companyId,
            ctx.branchId,
            productId,
            body.validity_months,
            body.entry_policy,
            body.entry_policy === "limited_visits" ? body.visit_quota : null,
            body.member_discount_percent,
            ctx.user.id,
          ]
        );
      }

      // Pastikan kanal venue ada, lalu distribusi default
      await client.query(
        `INSERT INTO ticketing.ticket_channels
           (company_id, branch_id, code, name, is_online, sort_order, created_by)
         VALUES
           ($1, $2, 'walk-in', 'Walk-in (Loket)', false, 10, $3),
           ($1, $2, 'website', 'Website Booking', true, 20, $3)
         ON CONFLICT (branch_id, code) DO NOTHING`,
        [ctx.companyId, ctx.branchId, ctx.user.id]
      );
      await client.query(
        `INSERT INTO ticketing.ticket_product_channels
           (company_id, branch_id, ticket_product_id, channel_id, is_distributed)
         SELECT $1, $2, $3, ch.id, (ch.code = 'walk-in')
         FROM ticketing.ticket_channels ch
         WHERE ch.branch_id = $2 AND ch.company_id = $1
         ON CONFLICT (ticket_product_id, channel_id) DO NOTHING`,
        [ctx.companyId, ctx.branchId, productId]
      );

      return { id: productId, code };
    });

    return successResponse(result, `Ticket ${result.code} dibuat`);
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    // Tabrakan kode auto (unique branch+code) — sangat jarang, arahkan retry
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Tabrakan kode ticket — coba simpan sekali lagi" },
        { status: 409 }
      );
    }
    console.error("[ticketing] create product error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal membuat ticket" },
      { status: 500 }
    );
  }
}
