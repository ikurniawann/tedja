import { NextResponse } from "next/server";
import { successResponse } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { requireTicketingContext } from "@/lib/ticketing/server";
import { isVariantPriceComplete } from "@/lib/ticketing/pricing";

interface VariantRow {
  id: string;
  ticket_product_id: string;
  name: string;
  price_regular: string | null;
  price_high: string | null;
}

interface OverrideRow {
  variant_id: string;
  channel_id: string;
  price_regular: string | null;
  price_high: string | null;
}

interface ChannelRow {
  id: string;
  code: string;
  name: string;
  is_online: boolean;
}

interface ProductRow {
  id: string;
  code: string;
  name: string;
  status: "draft" | "active";
  product_kind: "single" | "bundle";
  thumbnail_url: string | null;
}

interface DistributionRow {
  ticket_product_id: string;
  channel_id: string;
  is_distributed: boolean;
}

const toNum = (v: string | null) => (v === null ? null : Number(v));

/**
 * Papan Channel Manager: semua ticket × kanal venue — status distribusi,
 * override harga per varian, dan kelengkapan harga per kanal (guard
 * distribusi dihitung di sini juga supaya UI jujur dgn server).
 */
export async function GET() {
  const { error, ctx } = await requireTicketingContext();
  if (error) return error;

  try {
    const [products, variants, channels, distributions, overrides] =
      await Promise.all([
        query<ProductRow>(
          `SELECT id, code, name, status, product_kind, thumbnail_url
           FROM ticketing.ticket_products
           WHERE branch_id = $1 AND company_id = $2
           ORDER BY created_at DESC`,
          [ctx.branchId, ctx.companyId]
        ),
        query<VariantRow>(
          `SELECT id, ticket_product_id, name, price_regular, price_high
           FROM ticketing.ticket_product_variants
           WHERE branch_id = $1 AND company_id = $2 AND is_active = true
           ORDER BY sort_order`,
          [ctx.branchId, ctx.companyId]
        ),
        query<ChannelRow>(
          `SELECT id, code, name, is_online FROM ticketing.ticket_channels
           WHERE branch_id = $1 AND company_id = $2 AND is_active = true
           ORDER BY sort_order`,
          [ctx.branchId, ctx.companyId]
        ),
        query<DistributionRow>(
          `SELECT ticket_product_id, channel_id, is_distributed
           FROM ticketing.ticket_product_channels
           WHERE branch_id = $1 AND company_id = $2`,
          [ctx.branchId, ctx.companyId]
        ),
        query<OverrideRow>(
          `SELECT variant_id, channel_id, price_regular, price_high
           FROM ticketing.ticket_variant_channel_prices
           WHERE branch_id = $1 AND company_id = $2`,
          [ctx.branchId, ctx.companyId]
        ),
      ]);

    const overrideKey = (variantId: string, channelId: string) =>
      `${variantId}|${channelId}`;
    const overrideMap = new Map(
      overrides.map((o) => [overrideKey(o.variant_id, o.channel_id), o])
    );
    const distributionMap = new Map(
      distributions.map((d) => [`${d.ticket_product_id}|${d.channel_id}`, d])
    );

    const data = products.map((product) => {
      const productVariants = variants.filter(
        (v) => v.ticket_product_id === product.id
      );
      return {
        id: product.id,
        code: product.code,
        name: product.name,
        status: product.status,
        product_kind: product.product_kind,
        thumbnail_url: product.thumbnail_url,
        variants: productVariants.map((v) => ({
          id: v.id,
          name: v.name,
          price_regular: toNum(v.price_regular),
          price_high: toNum(v.price_high),
        })),
        channels: channels.map((channel) => {
          const distribution = distributionMap.get(
            `${product.id}|${channel.id}`
          );
          const channelOverrides = productVariants.map((v) => {
            const o = overrideMap.get(overrideKey(v.id, channel.id));
            return {
              variant_id: v.id,
              price_regular: o ? toNum(o.price_regular) : null,
              price_high: o ? toNum(o.price_high) : null,
            };
          });
          const priceComplete =
            productVariants.length > 0 &&
            productVariants.every((v, i) =>
              isVariantPriceComplete(
                {
                  price_regular: toNum(v.price_regular),
                  price_high: toNum(v.price_high),
                },
                channelOverrides[i]
              )
            );
          return {
            channel_id: channel.id,
            channel_code: channel.code,
            channel_name: channel.name,
            is_online: channel.is_online,
            is_distributed: distribution?.is_distributed ?? false,
            price_complete: priceComplete,
            overrides: channelOverrides,
          };
        }),
      };
    });

    return successResponse(data);
  } catch (err) {
    console.error("[ticketing] channel manager error:", err);
    return NextResponse.json(
      { success: false, error: "Gagal memuat channel manager" },
      { status: 500 }
    );
  }
}
