// Fase D — sisi server booking publik: resolusi venue via booking_slug,
// katalog kanal website ber-harga ter-resolve, dan lazy expiry booking.
// SEMUA fungsi di file ini dipanggil dari route TANPA auth — jangan
// pernah mengembalikan id internal venue ke klien; ctx hanya dipakai
// untuk query berikutnya di server.

import { query, queryOne } from "@/lib/db";
import { expandBundleMembers, type BundleMember } from "./bundle";
import {
  isDateBlockedOnline,
  resolveTicketPrice,
  resolveVariantPrice,
  type PricePair,
  type ProductDateRange,
  type SeasonKind,
} from "./pricing";

export interface PublicVenueCtx {
  companyId: string;
  branchId: string;
  websiteChannelId: string;
}

const SLUG_PATTERN = /^[a-z0-9-]{2,50}$/;

/**
 * Venue dari slug publik. Null bila slug tidak dikenal ATAU venue belum
 * punya kanal website aktif — dua-duanya 404 generik di route
 * (anti-enumerasi slug).
 */
export async function resolvePublicVenue(
  slug: string
): Promise<PublicVenueCtx | null> {
  if (!SLUG_PATTERN.test(slug)) return null;

  const settings = await queryOne<{ company_id: string; branch_id: string }>(
    `SELECT company_id, branch_id FROM ticketing.ticket_settings
     WHERE booking_slug = $1`,
    [slug]
  );
  if (!settings) return null;

  const channel = await queryOne<{ id: string }>(
    `SELECT id FROM ticketing.ticket_channels
     WHERE branch_id = $1 AND company_id = $2
       AND is_online = true AND is_active = true
     ORDER BY sort_order LIMIT 1`,
    [settings.branch_id, settings.company_id]
  );
  if (!channel) return null;

  return {
    companyId: settings.company_id,
    branchId: settings.branch_id,
    websiteChannelId: channel.id,
  };
}

export interface CatalogVariant {
  variant_id: string;
  variant_name: string;
  price: number;
  season_kind: SeasonKind;
  /**
   * Fase P — hanya varian paket: daftar anggota per 1 unit (urut, 1 entri
   * = 1 orang, menunjuk varian KOMPONEN + bobot alokasi). Kosong utk
   * tiket satuan.
   */
  members?: BundleMember[];
}

export interface CatalogProduct {
  ticket_product_id: string;
  code: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  product_kind: "single" | "bundle";
  variants: CatalogVariant[];
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  product_kind: "single" | "bundle";
}

interface CompositionRow {
  bundle_product_id: string;
  component_variant_id: string;
  qty: number;
  product_name: string;
  variant_name: string;
  component_product_id: string;
  component_status: string;
  component_kind: string;
  variant_is_active: boolean;
  price_regular: string | null;
  price_high: string | null;
}

interface VariantRow {
  id: string;
  ticket_product_id: string;
  name: string;
  price_regular: string | null;
  price_high: string | null;
}

interface DateRow extends ProductDateRange {
  ticket_product_id: string;
}

interface OverrideRow {
  variant_id: string;
  price_regular: string | null;
  price_high: string | null;
}

const toPair = (row: {
  price_regular: string | null;
  price_high: string | null;
}): PricePair => ({
  price_regular: row.price_regular === null ? null : Number(row.price_regular),
  price_high: row.price_high === null ? null : Number(row.price_high),
});

/**
 * Katalog publik utk satu tanggal: hanya produk Active + terdistribusi
 * ke kanal website + tidak diblok-online tanggal itu; harga per varian
 * di-resolve resolver v2 (override kanal website menang). Varian tanpa
 * harga lengkap tidak ditampilkan (guard R2 harusnya mencegah, tapi
 * jangan percaya state — hitung ulang di sini).
 */
export async function buildPublicCatalog(
  ctx: PublicVenueCtx,
  visitDate: string
): Promise<CatalogProduct[]> {
  const [products, variants, dates, overrides] = await Promise.all([
    query<ProductRow>(
      `SELECT p.id, p.code, p.name, p.description, p.thumbnail_url,
              p.product_kind
       FROM ticketing.ticket_products p
       JOIN ticketing.ticket_product_channels pc
         ON pc.ticket_product_id = p.id AND pc.channel_id = $3
        AND pc.is_distributed = true
       WHERE p.branch_id = $1 AND p.company_id = $2 AND p.status = 'active'
       ORDER BY p.code`,
      [ctx.branchId, ctx.companyId, ctx.websiteChannelId]
    ),
    query<VariantRow>(
      `SELECT id, ticket_product_id, name, price_regular, price_high
       FROM ticketing.ticket_product_variants
       WHERE branch_id = $1 AND company_id = $2 AND is_active = true
       ORDER BY sort_order`,
      [ctx.branchId, ctx.companyId]
    ),
    query<DateRow>(
      `SELECT ticket_product_id, date_kind, label,
              start_date::text AS start_date, end_date::text AS end_date,
              is_active
       FROM ticketing.ticket_product_dates
       WHERE branch_id = $1 AND company_id = $2 AND is_active = true`,
      [ctx.branchId, ctx.companyId]
    ),
    query<OverrideRow>(
      `SELECT variant_id, price_regular, price_high
       FROM ticketing.ticket_variant_channel_prices
       WHERE branch_id = $1 AND company_id = $2 AND channel_id = $3`,
      [ctx.branchId, ctx.companyId, ctx.websiteChannelId]
    ),
  ]);

  const overrideMap = new Map(overrides.map((o) => [o.variant_id, toPair(o)]));

  // Fase P — komposisi paket (batch): paket dgn komposisi kosong/komponen
  // tidak layak disembunyikan; blok-online KOMPONEN ikut memblok paket
  const bundleIds = products
    .filter((p) => p.product_kind === "bundle")
    .map((p) => p.id);
  const compositionRows =
    bundleIds.length > 0
      ? await query<CompositionRow>(
          `SELECT bi.bundle_product_id, bi.component_variant_id, bi.qty,
                  tp.name AS product_name, pv.name AS variant_name,
                  tp.id AS component_product_id, tp.status AS component_status,
                  tp.product_kind AS component_kind,
                  pv.is_active AS variant_is_active,
                  pv.price_regular, pv.price_high
           FROM ticketing.ticket_bundle_items bi
           JOIN ticketing.ticket_product_variants pv
             ON pv.id = bi.component_variant_id
           JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
           WHERE bi.bundle_product_id = ANY($1)
             AND bi.branch_id = $2 AND bi.company_id = $3
           ORDER BY bi.sort_order, bi.created_at`,
          [bundleIds, ctx.branchId, ctx.companyId]
        )
      : [];
  const compositionByBundle = new Map<string, CompositionRow[]>();
  for (const row of compositionRows) {
    const list = compositionByBundle.get(row.bundle_product_id) ?? [];
    list.push(row);
    compositionByBundle.set(row.bundle_product_id, list);
  }
  const isSellableComposition = (rows: CompositionRow[] | undefined) =>
    !!rows &&
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.component_status === "active" &&
        r.component_kind === "single" &&
        r.variant_is_active
    );

  const catalog: CatalogProduct[] = [];
  for (const product of products) {
    const productDates = dates.filter(
      (d) => d.ticket_product_id === product.id
    );

    let composition: CompositionRow[] = [];
    if (product.product_kind === "bundle") {
      const rows = compositionByBundle.get(product.id);
      if (!isSellableComposition(rows)) continue;
      composition = rows!;
      // Komponen diblok online tanggal ini → paketnya ikut tidak dijual
      const componentBlocked = composition.some((c) =>
        isDateBlockedOnline(
          visitDate,
          dates.filter((d) => d.ticket_product_id === c.component_product_id)
        )
      );
      if (componentBlocked) continue;
    }

    const resolvedVariants: CatalogVariant[] = [];
    let blocked = false;

    for (const variant of variants.filter(
      (v) => v.ticket_product_id === product.id
    )) {
      const result = resolveTicketPrice({
        visitDate,
        isOnlineChannel: true,
        dates: productDates,
        variant: toPair(variant),
        channelOverride: overrideMap.get(variant.id) ?? null,
      });
      if (!result.ok) {
        if (result.reason === "tanggal-diblok") blocked = true;
        continue; // harga bolong → varian disembunyikan, jangan menebak
      }

      // Anggota per unit paket: bobot alokasi = harga satuan komponen utk
      // musim paket (override kanal website menang bila terisi)
      const members =
        product.product_kind === "bundle"
          ? expandBundleMembers(
              composition.map((c) => ({
                component_variant_id: c.component_variant_id,
                qty: c.qty,
                product_name: c.product_name,
                variant_name: c.variant_name,
                weight_price: resolveVariantPrice({
                  variant: toPair(c),
                  channelOverride:
                    overrideMap.get(c.component_variant_id) ?? null,
                  seasonKind: result.seasonKind,
                }),
              }))
            )
          : undefined;

      resolvedVariants.push({
        variant_id: variant.id,
        variant_name: variant.name,
        price: result.price,
        season_kind: result.seasonKind,
        ...(members ? { members } : {}),
      });
    }

    if (blocked || resolvedVariants.length === 0) continue;
    catalog.push({
      ticket_product_id: product.id,
      code: product.code,
      name: product.name,
      description: product.description,
      thumbnail_url: product.thumbnail_url,
      product_kind: product.product_kind,
      variants: resolvedVariants,
    });
  }
  return catalog;
}

/**
 * Lazy expiry: booking `menunggu-bayar` yang lewat `expires_at` ditandai
 * `kedaluwarsa` saat disentuh (status page / redeem) — tanpa cron.
 * Mengembalikan true bila baris berubah.
 */
export async function expireBookingIfDue(bookingId: string): Promise<boolean> {
  const updated = await query<{ id: string }>(
    `UPDATE ticketing.ticket_bookings
     SET status = 'kedaluwarsa', updated_at = now()
     WHERE id = $1 AND status = 'menunggu-bayar'
       AND expires_at IS NOT NULL AND expires_at < now()
     RETURNING id`,
    [bookingId]
  );
  return updated.length > 0;
}
