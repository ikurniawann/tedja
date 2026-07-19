import { NextRequest, NextResponse } from 'next/server';
import { createPgClient } from "@/lib/pg/create-client";
import { enrichPosProductsWithPurchasingCogs } from '@/lib/pos/purchasing-sync';

type ProductVariantPayload = {
  name?: string;
  group_name?: string;
  price_adjustment?: number | string;
  display_order?: number | string;
};

type ProductModifierPayload = {
  name?: string;
  price_adjustment?: number | string;
  display_order?: number | string;
};

type ProductModifierGroupPayload = {
  name?: string;
  min_selection?: number | string;
  max_selection?: number | string;
  display_order?: number | string;
  modifiers?: ProductModifierPayload[];
};

type ProductCreatePayload = {
  sku?: string;
  name?: string;
  description?: string;
  category_id?: string;
  base_price?: number | string;
  cost_price?: number | string;
  xp?: number | string;
  xp_points?: number | string;
  station?: string;
  is_active?: boolean;
  variants?: ProductVariantPayload[];
  modifierGroups?: ProductModifierGroupPayload[];
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function withProductXpAlias<T extends Record<string, unknown>>(product: T) {
  return {
    ...product,
    xp: Number(product.xp_points ?? product.xp ?? 0),
    station: typeof product.station === 'string' ? product.station : 'kitchen',
  };
}

function normalizeStation(value?: string) {
  const station = String(value || '').trim().toLowerCase();
  if (['kitchen', 'bar', 'bakery', 'dessert', 'merchandise', 'photobooth'].includes(station)) {
    return station;
  }
  return 'kitchen';
}

// Initialize pg client (admin access)
// GET /api/pos/products - List all active products
export async function GET(request: NextRequest) {
  try {
    const db = createPgClient();
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const includeInactive = searchParams.get('include_inactive') === 'true';

    let query = db
      .from('pos_products')
      .select(`
        *,
        category:pos_categories(name),
        variants:pos_product_variants(*),
        modifiers:pos_product_modifiers(
          modifier_group:pos_modifier_groups(
            name,
            modifiers:pos_modifiers(*)
          )
        )
      `)
      .order('name');

    if (!includeInactive) {
      query = query.eq('is_active', true).eq('is_available', true);
    }

    if (category) {
      query = query.eq('category_id', category);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) throw error;

    const normalizedProducts = (data ?? []).map((product) =>
      withProductXpAlias(product as Record<string, unknown>)
    );

    const enrichedProducts = await enrichPosProductsWithPurchasingCogs(
      db,
      normalizedProducts as Array<Record<string, unknown>>
    );

    return NextResponse.json({ success: true, data: enrichedProducts });
  } catch (error: unknown) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/pos/products - Create new product
export async function POST(request: NextRequest) {
  try {
    const db = createPgClient();
    const body = (await request.json()) as ProductCreatePayload;
    const {
      sku,
      name,
      description,
      category_id,
      base_price,
      cost_price,
      xp = 0,
      xp_points,
      station,
      is_active = true,
      variants = [],
      modifierGroups = []
    } = body;

    // Validate required fields
    if (!sku || !name || !base_price) {
      return NextResponse.json(
        { success: false, error: 'SKU, name, and base_price are required' },
        { status: 400 }
      );
    }

    // Insert product
    const rawMinXp = (body as { min_xp?: unknown }).min_xp;
    const productPayload = {
      sku,
      name,
      description,
      category_id,
      base_price,
      cost_price: cost_price || 0,
      xp_points: Math.max(0, Number(xp_points ?? xp) || 0),
      station: normalizeStation(station),
      is_active,
      // Produk privilege member (EPIC-011 Fase C): null = produk umum
      min_xp:
        rawMinXp === undefined || rawMinXp === null || Number(rawMinXp) <= 0
          ? null
          : Math.floor(Number(rawMinXp)),
    };

    let { data: product, error: productError } = await db
      .from('pos_products')
      .insert(productPayload)
      .select()
      .single();

    if (productError?.code === '42703') {
      const legacyPayload: Omit<typeof productPayload, 'xp_points' | 'station'> & { xp?: number; station?: string } = { ...productPayload };
      legacyPayload.xp = productPayload.xp_points;
      delete (legacyPayload as { xp_points?: number }).xp_points;
      delete (legacyPayload as { station?: string }).station;
      delete (legacyPayload as { min_xp?: number | null }).min_xp;

      const legacyRetry = await db
        .from('pos_products')
        .insert(legacyPayload)
        .select()
        .single();

      if (legacyRetry.error?.code === '42703') {
        const payloadWithoutXp: Omit<typeof productPayload, 'xp_points' | 'station'> = { ...productPayload };
        delete (payloadWithoutXp as { xp_points?: number }).xp_points;
        delete (payloadWithoutXp as { station?: string }).station;
        delete (payloadWithoutXp as { min_xp?: number | null }).min_xp;
        const plainRetry = await db
          .from('pos_products')
          .insert(payloadWithoutXp)
          .select()
          .single();
        product = plainRetry.data;
        productError = plainRetry.error;
      } else {
        product = legacyRetry.data;
        productError = legacyRetry.error;
      }
    }

    if (productError) throw productError;
    if (!product) throw new Error('Failed to create product');

    // Insert variants if provided
    if (variants.length > 0) {
      const variantsData = variants.map((v: ProductVariantPayload) => ({
        product_id: product.id,
        name: v.name,
        group_name: v.group_name,
        price_adjustment: v.price_adjustment || 0,
        display_order: v.display_order || 0
      }));

      const { error: variantError } = await db
        .from('pos_product_variants')
        .insert(variantsData);

      if (variantError) throw variantError;
    }

    // Insert modifier groups and modifiers if provided
    for (const group of modifierGroups) {
      // Insert modifier group
      const { data: modifierGroup, error: groupError } = await db
        .from('pos_modifier_groups')
        .insert({
          name: group.name,
          min_selection: group.min_selection || 0,
          max_selection: group.max_selection || 1,
          display_order: group.display_order || 0
        })
        .select()
        .single();

      if (groupError) throw groupError;

      // Link product to modifier group
      const { error: linkError } = await db
        .from('pos_product_modifiers')
        .insert({
          product_id: product.id,
          modifier_group_id: modifierGroup.id
        });

      if (linkError) throw linkError;

      // Insert modifiers
      if (group.modifiers && group.modifiers.length > 0) {
        const modifiersData = group.modifiers.map((m: ProductModifierPayload) => ({
          group_id: modifierGroup.id,
          name: m.name,
          price_adjustment: m.price_adjustment || 0,
          display_order: m.display_order || 0
        }));

        const { error: modifierError } = await db
          .from('pos_modifiers')
          .insert(modifiersData);

        if (modifierError) throw modifierError;
      }
    }

    // Fetch complete product with relations
    const { data: completeProduct } = await db
      .from('pos_products')
      .select(`
        *,
        variants:pos_product_variants(*),
        modifiers:pos_product_modifiers(
          modifier_group:pos_modifier_groups(
            name,
            modifiers:pos_modifiers(*)
          )
        )
      `)
      .eq('id', product.id)
      .single();

    return NextResponse.json({
      success: true,
      data: completeProduct ? withProductXpAlias(completeProduct as Record<string, unknown>) : null,
    });
  } catch (error: unknown) {
    console.error('Error creating product:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
