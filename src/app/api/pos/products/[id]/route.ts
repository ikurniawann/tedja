import { NextRequest, NextResponse } from 'next/server';
import { getPosSession } from '@/lib/api/auth';
import { createPgClient } from "@/lib/pg/create-client";

type ProductUpdatePayload = {
  xp?: number | string;
  xp_points?: number | string;
  station?: string;
  is_active?: boolean;
  is_available?: boolean;
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json()) as ProductUpdatePayload;
    const hasXpUpdate = body.xp_points !== undefined || body.xp !== undefined;
    const hasStationUpdate = body.station !== undefined;
    const hasActiveUpdate = body.is_active !== undefined;
    const hasAvailableUpdate = body.is_available !== undefined;
    // Produk privilege member (EPIC-011 Fase C): null = produk umum
    const hasMinXpUpdate = (body as { min_xp?: unknown }).min_xp !== undefined;
    const rawMinXp = (body as { min_xp?: unknown }).min_xp;
    const xpPoints = Math.max(0, Number(body.xp_points ?? body.xp ?? 0) || 0);
    const db = createPgClient();
    const updatePayload: Record<string, number | string | boolean | null> = {
      updated_at: new Date().toISOString(),
    };

    if (hasXpUpdate) updatePayload.xp_points = xpPoints;
    if (hasStationUpdate) updatePayload.station = normalizeStation(body.station);
    if (hasActiveUpdate) updatePayload.is_active = Boolean(body.is_active);
    if (hasAvailableUpdate) updatePayload.is_available = Boolean(body.is_available);
    if (hasMinXpUpdate) {
      updatePayload.min_xp =
        rawMinXp === null || rawMinXp === "" || Number(rawMinXp) <= 0
          ? null
          : Math.floor(Number(rawMinXp)) || null;
    }

    if (!hasXpUpdate && !hasStationUpdate && !hasActiveUpdate && !hasAvailableUpdate && !hasMinXpUpdate) {
      return NextResponse.json({ success: false, error: 'No product fields to update' }, { status: 400 });
    }

    let { data, error } = await db
      .from('pos_products')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error?.code === '42703') {
      const legacyPayload = { ...updatePayload };
      if (hasXpUpdate) {
        legacyPayload.xp = xpPoints;
        delete legacyPayload.xp_points;
      }
      delete legacyPayload.station;

      const legacyRetry = await db
        .from('pos_products')
        .update(legacyPayload)
        .eq('id', id)
        .select('*')
        .single();

      data = legacyRetry.data;
      error = legacyRetry.error;
    }

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data ? withProductXpAlias(data as Record<string, unknown>) : null,
    });
  } catch (error: unknown) {
    console.error('Error updating POS product:', error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
