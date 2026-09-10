// EPIC-047 Fase 1A — generate/reconcile matriks varian (ukuran x warna x ...)
// jadi baris pos_product_skus dalam satu transaksi. Idempoten: kirim matriks
// yang sama dua kali = no-op. SKU ber-stok tidak pernah hilang diam-diam
// (409 sebelum tulisan apa pun terjadi).

import { NextRequest, NextResponse } from 'next/server';
import { getPosSession } from '@/lib/api/auth';
import { createPgClient } from '@/lib/pg/create-client';
import { withTransaction } from '@/lib/db';
import {
  normalizeSkuPayload,
  isUniqueViolation,
  type SkuPayload,
} from '@/lib/pos/merchandise-sku-payload';
import {
  blockedDeactivations,
  buildSkuCode,
  buildSkuName,
  diffMatrix,
  expandMatrix,
  type ExistingSku,
  type VariantAxis,
} from '@/lib/pos/merchandise-variants';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Ditandai lewat instance-check saat validasi baris hasil generate gagal. */
class SkuValidationError extends Error {}

type SkuRow = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  options: Record<string, string> | null;
  barcode: string | null;
  price_override: string | number | null;
  stock_quantity: string | number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type MatrixBody = {
  axes?: VariantAxis[];
  price_override?: number | string | null;
  barcode_prefix?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sessionUserId = await getPosSession();
  if (!sessionUserId) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as MatrixBody;

    const wanted = expandMatrix(Array.isArray(body.axes) ? body.axes : []);
    if (wanted.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Sumbu varian (axes) wajib diisi, minimal satu sumbu dengan nilai' },
        { status: 400 }
      );
    }

    // Validasi price_override sekali di awal (sama untuk semua baris) —
    // reuse aturan normalizeSkuPayload.
    let priceOverrideColumn: number | null = null;
    if (body.price_override !== undefined) {
      const normPrice = normalizeSkuPayload({ price_override: body.price_override });
      if (!normPrice.ok) {
        return NextResponse.json({ success: false, error: normPrice.error }, { status: 400 });
      }
      priceOverrideColumn = (normPrice.columns.price_override as number | null) ?? null;
    }
    const barcodePrefix =
      typeof body.barcode_prefix === 'string' ? body.barcode_prefix.trim() : '';

    const db = createPgClient();

    // SKU hanya untuk produk merchandise — jaga invariant di server (sama
    // dengan POST /api/pos/products/[id]/skus).
    const { data: product, error: productError } = await db
      .from('pos_products')
      .select('id, sku, name, product_kind')
      .eq('id', id)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) {
      return NextResponse.json({ success: false, error: 'Produk tidak ditemukan' }, { status: 404 });
    }
    const productRow = product as { id: string; sku: string; name: string; product_kind?: string };
    if (productRow.product_kind !== 'merchandise') {
      return NextResponse.json(
        { success: false, error: 'Varian SKU hanya untuk produk merchandise' },
        { status: 400 }
      );
    }

    const txResult = await withTransaction(async (client) => {
      // FOR UPDATE: kunci baris SKU produk ini selama diff + tulis, agar dua
      // request matriks yang tumpang tindih tidak balapan.
      const existingRes = await client.query<SkuRow>(
        `SELECT id, product_id, sku, name, options, barcode, price_override,
                stock_quantity, is_active, created_at, updated_at
         FROM pos.pos_product_skus
         WHERE product_id = $1
         FOR UPDATE`,
        [id]
      );
      const existing: (SkuRow & ExistingSku)[] = existingRes.rows.map((row) => ({
        ...row,
        options: row.options ?? {},
        stock_quantity: Number(row.stock_quantity),
      }));

      const diff = diffMatrix(existing, wanted);
      const deactivateIds = diff.deactivate.map((row) => row.id);
      const blocked = blockedDeactivations(existing, deactivateIds);

      // Cek DULU sebelum tulisan apa pun — 409 harus meninggalkan nol
      // perubahan.
      if (blocked.length > 0) {
        return { kind: 'blocked' as const, blocked };
      }

      const created: SkuRow[] = [];
      for (const options of diff.create) {
        const sku = buildSkuCode(productRow.sku, options);
        const name = buildSkuName(productRow.name, options);
        const barcode = barcodePrefix ? `${barcodePrefix}${sku}` : null;
        const payload: SkuPayload = {
          sku,
          name,
          options,
          barcode,
          price_override: priceOverrideColumn,
          stock_quantity: 0,
          is_active: true,
        };
        const normalized = normalizeSkuPayload(payload, { requireCore: true });
        if (!normalized.ok) {
          throw new SkuValidationError(normalized.error);
        }
        const cols = normalized.columns as Required<Pick<SkuPayload, 'sku' | 'name'>> &
          Omit<SkuPayload, 'sku' | 'name'>;
        const insertRes = await client.query<SkuRow>(
          `INSERT INTO pos.pos_product_skus
             (product_id, sku, name, options, barcode, price_override, stock_quantity, is_active)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
           RETURNING id, product_id, sku, name, options, barcode, price_override,
                     stock_quantity, is_active, created_at, updated_at`,
          [
            id,
            cols.sku,
            cols.name,
            JSON.stringify(cols.options ?? options),
            cols.barcode ?? null,
            cols.price_override ?? null,
            cols.stock_quantity ?? 0,
            cols.is_active ?? true,
          ]
        );
        created.push(insertRes.rows[0]);
      }

      const deactivated: SkuRow[] = [];
      for (const row of diff.deactivate) {
        const updRes = await client.query<SkuRow>(
          `UPDATE pos.pos_product_skus
           SET is_active = false, updated_at = now()
           WHERE id = $1
           RETURNING id, product_id, sku, name, options, barcode, price_override,
                     stock_quantity, is_active, created_at, updated_at`,
          [row.id]
        );
        deactivated.push(updRes.rows[0]);
      }

      const allRes = await client.query<SkuRow>(
        `SELECT id, product_id, sku, name, options, barcode, price_override,
                stock_quantity, is_active, created_at, updated_at
         FROM pos.pos_product_skus
         WHERE product_id = $1
         ORDER BY name`,
        [id]
      );

      return {
        kind: 'ok' as const,
        created,
        deactivated,
        kept: diff.keep,
        skus: allRes.rows,
      };
    });

    if (txResult.kind === 'blocked') {
      return NextResponse.json(
        {
          success: false,
          error: 'SKU dengan stok masih ada tidak bisa dinonaktifkan otomatis — kosongkan stoknya dulu',
          blocked: txResult.blocked.map((row) => ({
            id: row.id,
            sku: row.sku,
            name: row.name,
            stock_quantity: row.stock_quantity,
          })),
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        created: txResult.created,
        deactivated: txResult.deactivated,
        kept: txResult.kept,
        skus: txResult.skus,
      },
    });
  } catch (error: unknown) {
    if (error instanceof SkuValidationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { success: false, error: 'Kode SKU / barcode sudah dipakai varian lain' },
        { status: 409 }
      );
    }
    console.error('Error generating SKU matrix:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
