import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { paginatedResponse, successResponse } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  allocateBundlePrice,
  expandBundleMembers,
} from "@/lib/ticketing/bundle";
import {
  bundleCompositionIssue,
  execFromClient,
  loadBundleComposition,
  toBundleComponents,
} from "@/lib/ticketing/bundle-server";
import {
  resolveVariantPriceOnDate,
  todayJakartaDate,
} from "@/lib/ticketing/pricing-server";
import {
  PAYMENT_MODES,
  TICKETING_OPERATOR_ROLES,
  isValidNfcUid,
  normalizeNfcUid,
  requireTicketingContext,
} from "@/lib/ticketing/server";

// Metode uang fisik yang diterima loket/kasir — konsisten dengan POS.
const CASH_METHODS = ["cash", "qris", "card"] as const;

const VISIT_STATUSES = ["open", "settled", "void"] as const;

interface VisitListRow {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  payment_mode: "postpaid" | "prepaid";
  credit_limit: string | null;
  status: (typeof VISIT_STATUSES)[number];
  opened_at: string;
  settled_at: string | null;
  band_count: string;
  active_band_count: string;
  debit: string;
  kredit: string;
  total_count: string;
}

export async function GET(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  try {
    const sp = request.nextUrl.searchParams;
    const status = VISIT_STATUSES.includes(
      sp.get("status") as (typeof VISIT_STATUSES)[number]
    )
      ? (sp.get("status") as string)
      : "open";
    const q = (sp.get("q") ?? "").trim();
    const page = Math.max(1, Number(sp.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));

    const conditions = ["v.branch_id = $1", "v.company_id = $2", "v.status = $3"];
    const params: unknown[] = [ctx.branchId, ctx.companyId, status];
    if (q) {
      params.push(`%${q}%`, normalizeNfcUid(q) || q);
      conditions.push(
        `(v.contact_name ILIKE $${params.length - 1}
          OR v.contact_phone ILIKE $${params.length - 1}
          OR EXISTS (
            SELECT 1 FROM ticketing.ticket_visit_bands vb
            JOIN ticketing.ticket_bands b ON b.id = vb.band_id
            WHERE vb.visit_id = v.id AND b.nfc_uid = $${params.length}
          ))`
      );
    }

    params.push(limit, (page - 1) * limit);
    const rows = await query<VisitListRow>(
      `SELECT v.id, v.contact_name, v.contact_phone, v.payment_mode,
              v.credit_limit, v.status, v.opened_at, v.settled_at,
              (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
               WHERE vb.visit_id = v.id) AS band_count,
              (SELECT COUNT(*) FROM ticketing.ticket_visit_bands vb
               WHERE vb.visit_id = v.id AND vb.status = 'aktif') AS active_band_count,
              COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
               WHERE c.visit_id = v.id AND c.direction = 'debit'), 0) AS debit,
              COALESCE((SELECT SUM(c.amount) FROM ticketing.ticket_visit_charges c
               WHERE c.visit_id = v.id AND c.direction = 'kredit'), 0) AS kredit,
              COUNT(*) OVER() AS total_count
       FROM ticketing.ticket_visits v
       WHERE ${conditions.join(" AND ")}
       ORDER BY v.opened_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const data = rows.map((row) => {
      const { total_count, ...visit } = row;
      void total_count;
      const debit = Number(visit.debit);
      const kredit = Number(visit.kredit);
      return {
        ...visit,
        band_count: Number(visit.band_count),
        active_band_count: Number(visit.active_band_count),
        debit,
        kredit,
        outstanding: Math.round((debit - kredit) * 100) / 100,
        saldo: Math.round((kredit - debit) * 100) / 100,
      };
    });
    return paginatedResponse(data, {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("[ticketing] list visits error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat daftar kunjungan" },
      { status: 500 }
    );
  }
}

const registerVisitSchema = z.object({
  contact_name: z.string().trim().min(1).max(150),
  contact_phone: z.string().trim().max(30).optional().nullable(),
  payment_mode: z.enum(PAYMENT_MODES),
  // plafon khusus visit ini; kosong = default venue dari ticket_settings
  credit_limit: z.number().min(0).max(1_000_000_000).optional().nullable(),
  deposit: z
    .object({
      amount: z.number().positive().max(1_000_000_000),
      method: z.enum(CASH_METHODS),
    })
    .optional()
    .nullable(),
  bands: z
    .array(
      z.object({
        nfc_uid: z.string().trim().min(1).max(80),
        variant_id: z.string().uuid(),
      })
    )
    .max(50)
    .default([]),
  // Fase P — pembelian paket: 1 entri = 1 unit paket; band_uids urut
  // mengikuti urutan anggota komposisi (server yang memetakan varian
  // komponen — klien tidak menentukan harga/varian per gelang)
  bundles: z
    .array(
      z.object({
        bundle_variant_id: z.string().uuid(),
        band_uids: z
          .array(z.string().trim().min(1).max(80))
          .min(1)
          .max(20),
      })
    )
    .max(10)
    .default([]),
});

export async function POST(request: NextRequest) {
  const { error, ctx } = await requireTicketingContext(TICKETING_OPERATOR_ROLES);
  if (error) return error;

  const rate = checkRateLimit(`ticketing-register:${ctx.user.id}`, 20);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak registrasi — coba lagi sebentar" },
      { status: 429 }
    );
  }

  try {
    const parsed = registerVisitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }
    const body = parsed.data;

    if (body.bands.length === 0 && body.bundles.length === 0) {
      return NextResponse.json(
        { success: false, error: "Minimal satu gelang harus di-tap" },
        { status: 400 }
      );
    }

    // Semua UID (satuan + anggota paket) dinormalisasi & unik global
    const uids = [
      ...body.bands.map((b) => normalizeNfcUid(b.nfc_uid)),
      ...body.bundles.flatMap((bu) => bu.band_uids.map(normalizeNfcUid)),
    ];
    if (uids.some((uid) => !isValidNfcUid(uid))) {
      return NextResponse.json(
        { success: false, error: "Ada UID gelang yang tidak valid" },
        { status: 400 }
      );
    }
    if (new Set(uids).size !== uids.length) {
      return NextResponse.json(
        { success: false, error: "Ada gelang yang di-tap dua kali" },
        { status: 400 }
      );
    }
    if (body.payment_mode === "prepaid" && !body.deposit) {
      return NextResponse.json(
        { success: false, error: "Mode prepaid wajib top-up deposit awal" },
        { status: 400 }
      );
    }

    const result = await withTransaction(async (client) => {
      // Default plafon dari pengaturan venue (postpaid)
      const settingsResult = await client.query<{
        default_credit_limit: string;
      }>(
        `SELECT default_credit_limit FROM ticketing.ticket_settings
         WHERE branch_id = $1 AND company_id = $2`,
        [ctx.branchId, ctx.companyId]
      );
      const defaultLimit = settingsResult.rows[0]
        ? Number(settingsResult.rows[0].default_credit_limit)
        : 500000;

      const channelResult = await client.query<{ id: string }>(
        `SELECT id FROM ticketing.ticket_channels
         WHERE branch_id = $1 AND company_id = $2 AND code = 'walk-in'
           AND is_active = true`,
        [ctx.branchId, ctx.companyId]
      );
      if (channelResult.rows.length === 0) {
        throw Object.assign(
          new Error("Kanal walk-in belum aktif — buka Pengaturan Tiket dulu"),
          { statusCode: 400 }
        );
      }
      const channelId = channelResult.rows[0].id;

      // Kunci gelang deterministik (ORDER BY id — hindari deadlock)
      const bandsResult = await client.query<{
        id: string;
        nfc_uid: string;
        status: string;
      }>(
        `SELECT id, nfc_uid, status FROM ticketing.ticket_bands
         WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = ANY($3)
         ORDER BY id
         FOR UPDATE`,
        [ctx.branchId, ctx.companyId, uids]
      );
      const bandByUid = new Map(bandsResult.rows.map((b) => [b.nfc_uid, b]));
      for (const uid of uids) {
        const band = bandByUid.get(uid);
        if (!band) {
          throw Object.assign(
            new Error(`Gelang ${uid} belum terdaftar di registry`),
            { statusCode: 400 }
          );
        }
        if (band.status !== "tersedia") {
          throw Object.assign(
            new Error(`Gelang ${uid} berstatus "${band.status}" — tidak bisa dipakai`),
            { statusCode: 409 }
          );
        }
      }

      // Varian satuan valid = milik venue, aktif, produk SATUAN Active
      // DAN terdistribusi ke kanal walk-in (Channel Manager); varian
      // paket tidak boleh menempel langsung ke satu gelang
      const variantIds = [...new Set(body.bands.map((b) => b.variant_id))];
      if (variantIds.length > 0) {
        const variantsResult = await client.query<{ id: string }>(
          `SELECT pv.id
           FROM ticketing.ticket_product_variants pv
           JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
           JOIN ticketing.ticket_product_channels pc
             ON pc.ticket_product_id = tp.id AND pc.channel_id = $4
                AND pc.is_distributed = true
           WHERE pv.branch_id = $1 AND pv.company_id = $2 AND pv.id = ANY($3)
             AND pv.is_active = true AND tp.status = 'active'
             AND tp.product_kind = 'single'`,
          [ctx.branchId, ctx.companyId, variantIds, channelId]
        );
        if (variantsResult.rows.length !== variantIds.length) {
          throw Object.assign(
            new Error(
              "Ada varian ticket yang tidak dikenal / nonaktif / belum didistribusi ke POS"
            ),
            { statusCode: 400 }
          );
        }
      }

      // Fase P — pembelian paket: resolve harga paket HARI INI di kanal
      // walk-in lalu prorata ke anggota; harga alokasi di-snapshot di
      // visit_bands supaya gate tap tinggal men-charge tanpa resolve ulang
      interface PreparedBundleBand {
        uid: string;
        component_variant_id: string;
        bundle_product_id: string;
        bundle_unit_no: number;
        allocated_price: number;
        member_label: string;
      }
      const bundleBands: PreparedBundleBand[] = [];
      if (body.bundles.length > 0) {
        const visitDate = todayJakartaDate();
        const exec = execFromClient(client);
        const bundleVariantIds = [
          ...new Set(body.bundles.map((bu) => bu.bundle_variant_id)),
        ];
        const bundleVariantsResult = await client.query<{
          id: string;
          ticket_product_id: string;
          bundle_name: string;
        }>(
          `SELECT pv.id, pv.ticket_product_id, tp.name AS bundle_name
           FROM ticketing.ticket_product_variants pv
           JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
           JOIN ticketing.ticket_product_channels pc
             ON pc.ticket_product_id = tp.id AND pc.channel_id = $4
                AND pc.is_distributed = true
           WHERE pv.branch_id = $1 AND pv.company_id = $2 AND pv.id = ANY($3)
             AND pv.is_active = true AND tp.status = 'active'
             AND tp.product_kind = 'bundle'`,
          [ctx.branchId, ctx.companyId, bundleVariantIds, channelId]
        );
        const bundleVariantById = new Map(
          bundleVariantsResult.rows.map((r) => [r.id, r])
        );
        if (bundleVariantById.size !== bundleVariantIds.length) {
          throw Object.assign(
            new Error(
              "Ada paket yang tidak dikenal / nonaktif / belum didistribusi ke POS"
            ),
            { statusCode: 400 }
          );
        }

        let unitNo = 0;
        for (const purchase of body.bundles) {
          const bundleVariant = bundleVariantById.get(purchase.bundle_variant_id)!;
          const composition = await loadBundleComposition(exec, {
            companyId: ctx.companyId,
            branchId: ctx.branchId,
            bundleProductId: bundleVariant.ticket_product_id,
          });
          const issue = bundleCompositionIssue(composition);
          if (issue) {
            throw Object.assign(
              new Error(`Paket "${bundleVariant.bundle_name}" tidak layak jual: ${issue}`),
              { statusCode: 400 }
            );
          }

          const resolved = await resolveVariantPriceOnDate(client, {
            companyId: ctx.companyId,
            branchId: ctx.branchId,
            variantId: purchase.bundle_variant_id,
            channelId,
            visitDate,
          });
          if (!resolved.ok) {
            throw Object.assign(
              new Error(
                `Harga paket "${bundleVariant.bundle_name}" belum diisi — lengkapi di Master Ticket`
              ),
              { statusCode: 400 }
            );
          }

          const members = expandBundleMembers(
            toBundleComponents(composition, resolved.seasonKind)
          );
          if (purchase.band_uids.length !== members.length) {
            throw Object.assign(
              new Error(
                `Paket "${bundleVariant.bundle_name}" butuh ${members.length} gelang per unit — di-tap ${purchase.band_uids.length}`
              ),
              { statusCode: 400 }
            );
          }
          const shares = allocateBundlePrice(
            resolved.price,
            members.map((m) => m.weight_price)
          );
          unitNo += 1;
          members.forEach((member, index) => {
            bundleBands.push({
              uid: normalizeNfcUid(purchase.band_uids[index]),
              component_variant_id: member.component_variant_id,
              bundle_product_id: bundleVariant.ticket_product_id,
              bundle_unit_no: unitNo,
              allocated_price: shares[index],
              member_label: `${bundleVariant.bundle_name} — ${member.member_label}`,
            });
          });
        }
      }

      const creditLimit =
        body.payment_mode === "postpaid"
          ? (body.credit_limit ?? defaultLimit)
          : null;

      const visitResult = await client.query<{ id: string }>(
        `INSERT INTO ticketing.ticket_visits
           (company_id, branch_id, contact_name, contact_phone, channel_id,
            payment_mode, credit_limit, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          ctx.companyId,
          ctx.branchId,
          body.contact_name,
          body.contact_phone || null,
          channelId,
          body.payment_mode,
          creditLimit,
          ctx.user.id,
        ]
      );
      const visitId = visitResult.rows[0].id;

      for (const item of body.bands) {
        const uid = normalizeNfcUid(item.nfc_uid);
        const band = bandByUid.get(uid)!;
        await client.query(
          `INSERT INTO ticketing.ticket_visit_bands
             (company_id, branch_id, visit_id, band_id, variant_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [ctx.companyId, ctx.branchId, visitId, band.id, item.variant_id]
        );
        await client.query(
          `UPDATE ticketing.ticket_bands
           SET status = 'dipakai', updated_at = now()
           WHERE id = $1`,
          [band.id]
        );
      }

      // Anggota paket: gelang menunjuk varian KOMPONEN + snapshot alokasi
      for (const member of bundleBands) {
        const band = bandByUid.get(member.uid)!;
        await client.query(
          `INSERT INTO ticketing.ticket_visit_bands
             (company_id, branch_id, visit_id, band_id, variant_id,
              bundle_product_id, bundle_unit_no, allocated_price, member_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ctx.companyId,
            ctx.branchId,
            visitId,
            band.id,
            member.component_variant_id,
            member.bundle_product_id,
            member.bundle_unit_no,
            member.allocated_price,
            member.member_label,
          ]
        );
        await client.query(
          `UPDATE ticketing.ticket_bands
           SET status = 'dipakai', updated_at = now()
           WHERE id = $1`,
          [band.id]
        );
      }

      if (body.payment_mode === "prepaid" && body.deposit) {
        await client.query(
          `INSERT INTO ticketing.ticket_visit_charges
             (company_id, branch_id, visit_id, charge_type, direction,
              description, amount, payment_method, created_by)
           VALUES ($1, $2, $3, 'deposit', 'kredit', $4, $5, $6, $7)`,
          [
            ctx.companyId,
            ctx.branchId,
            visitId,
            `Top-up deposit awal (${body.deposit.method})`,
            Math.round(body.deposit.amount * 100) / 100,
            body.deposit.method,
            ctx.user.id,
          ]
        );
      }

      return { visitId };
    });

    return successResponse({ id: result.visitId }, "Kunjungan terdaftar");
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      return NextResponse.json(
        { success: false, error: (err as Error).message },
        { status: statusCode }
      );
    }
    console.error("[ticketing] register visit error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal mendaftarkan kunjungan" },
      { status: 500 }
    );
  }
}
