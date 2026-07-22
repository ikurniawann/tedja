// Fase D — sisi server booking publik: resolusi venue via booking_slug,
// katalog kanal website ber-harga ter-resolve, dan lazy expiry booking.
// SEMUA fungsi di file ini dipanggil dari route TANPA auth — jangan
// pernah mengembalikan id internal venue ke klien; ctx hanya dipakai
// untuk query berikutnya di server.

import { query, queryOne } from "@/lib/db";
import {
  resolveTicketPrice,
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
}

export interface CatalogProduct {
  ticket_product_id: string;
  code: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  variants: CatalogVariant[];
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
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
      `SELECT p.id, p.code, p.name, p.description, p.thumbnail_url
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

  const catalog: CatalogProduct[] = [];
  for (const product of products) {
    const productDates = dates.filter(
      (d) => d.ticket_product_id === product.id
    );
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
      resolvedVariants.push({
        variant_id: variant.id,
        variant_name: variant.name,
        price: result.price,
        season_kind: result.seasonKind,
      });
    }

    if (blocked || resolvedVariants.length === 0) continue;
    catalog.push({
      ticket_product_id: product.id,
      code: product.code,
      name: product.name,
      description: product.description,
      thumbnail_url: product.thumbnail_url,
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
