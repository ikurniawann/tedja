// EPIC-039 Fase C — settings modul kurir (admin): provider, origin, kurir, markup.

import { NextRequest, NextResponse } from 'next/server';
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { createPgClient } from '@/lib/pg/create-client';
import {
  getOrCreateShippingSettings,
  DEFAULT_COURIERS,
} from '@/lib/shop/shipping';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.shop);
    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    return NextResponse.json({ success: true, data: settings });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error loading shipping settings:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

type SettingsPatchBody = {
  provider?: string;
  origin_area_id?: string | null;
  origin_district_id?: string | null;
  origin_label?: string | null;
  origin_postal_code?: string | null;
  origin_address?: string | null;
  origin_contact_name?: string | null;
  origin_contact_phone?: string | null;
  couriers?: string;
  markup_amount?: number | string;
};

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireIamMenuPrefix(IAM.shop);
    const body = (await request.json()) as SettingsPatchBody;
    const payload: Record<string, string | number | null> = {};

    if (body.provider !== undefined) {
      const provider = String(body.provider).toLowerCase();
      if (!['biteship', 'rajaongkir'].includes(provider)) {
        return NextResponse.json(
          { success: false, error: 'Provider harus biteship atau rajaongkir' },
          { status: 400 }
        );
      }
      payload.provider = provider;
    }

    for (const key of [
      'origin_area_id',
      'origin_district_id',
      'origin_label',
      'origin_postal_code',
      'origin_address',
      'origin_contact_name',
      'origin_contact_phone',
    ] as const) {
      if (body[key] !== undefined) {
        payload[key] = body[key] ? String(body[key]) : null;
      }
    }

    if (body.couriers !== undefined) {
      const couriers = String(body.couriers || DEFAULT_COURIERS)
        .split(',')
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean);
      if (couriers.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Minimal satu kurir harus aktif' },
          { status: 400 }
        );
      }
      payload.couriers = couriers.join(',');
    }

    if (body.markup_amount !== undefined) {
      const markup = Number(body.markup_amount);
      if (!Number.isFinite(markup) || markup < 0) {
        return NextResponse.json(
          { success: false, error: 'Markup harus angka ≥ 0' },
          { status: 400 }
        );
      }
      payload.markup_amount = markup;
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ success: false, error: 'Tidak ada field yang diubah' }, { status: 400 });
    }

    const db = createPgClient();
    const settings = await getOrCreateShippingSettings(db);
    const { data, error } = await db
      .from('shipping_settings', 'shop')
      .update({ ...payload, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('id', settings.id)
      .select('*')
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error('Error updating shipping settings:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
