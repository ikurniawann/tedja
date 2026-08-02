// EPIC-039 Fase A — klaim & restore stok merchandise (pola "klaim-dulu").
//
// Merchandise = pos_products.product_kind='merchandise' + inventory_tracking.
// Stoknya flat di pos_products.inventory_quantity (tanpa BOM). Klaim terjadi
// SEBELUM order dibuat: fungsi SQL pos_sell_merchandise_stock men-decrement
// atomik ber-guard (cukup stok ATAU allow_negative_stock). Produk non-merch
// dilewati oleh fungsi SQL itu sendiri ({skipped: true}) sehingga pemanggil
// tidak perlu memfilter jenis produk lebih dulu.

import type { DbClient } from "@/lib/pg/types";

export type MerchStockClaim = { productId: string; qty: number };

type SellStockResult = {
  success?: boolean;
  skipped?: boolean;
  restored?: boolean;
  reason?: string;
  quantity_after?: number;
};

type ClaimResult =
  | { ok: true; claims: MerchStockClaim[] }
  | { ok: false; status: number; reason: string };

function aggregateByProduct(
  items: Array<{ product_id?: string | null; quantity?: number | string | null }>
): MerchStockClaim[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    const productId = String(item.product_id || "");
    const qty = Number(item.quantity) || 0;
    if (!productId || qty <= 0) continue;
    totals.set(productId, (totals.get(productId) ?? 0) + qty);
  }
  return Array.from(totals, ([productId, qty]) => ({ productId, qty }));
}

/**
 * Klaim stok untuk semua baris order sekaligus (agregat per produk).
 * Gagal di tengah → klaim yang sudah jadi dikembalikan sebelum return.
 */
export async function claimMerchandiseStock(
  db: DbClient,
  items: Array<{ product_id?: string | null; quantity?: number | string | null }>
): Promise<ClaimResult> {
  const targets = aggregateByProduct(items);
  const claims: MerchStockClaim[] = [];

  for (const target of targets) {
    const { data, error } = await db.rpc("pos_sell_merchandise_stock", {
      p_product_id: target.productId,
      p_qty: target.qty,
    });

    if (error) {
      console.error(
        `[pos] merch stock claim error: product=${target.productId}:`,
        error
      );
      await restoreMerchandiseStock(db, claims);
      return { ok: false, status: 500, reason: "Gagal memproses stok merchandise" };
    }

    const result = (data ?? {}) as SellStockResult;
    if (result.success === false) {
      await restoreMerchandiseStock(db, claims);
      const name = await resolveProductName(db, target.productId);
      return {
        ok: false,
        status: 400,
        reason: `Stok ${name} tidak cukup untuk jumlah yang diminta`,
      };
    }

    if (!result.skipped) {
      claims.push(target);
    }
  }

  return { ok: true, claims };
}

/** Kompensasi: kembalikan stok yang sudah diklaim (idempoten via daftar klaim). */
export async function restoreMerchandiseStock(
  db: DbClient,
  claims: MerchStockClaim[]
): Promise<void> {
  for (const claim of claims) {
    const { error } = await db.rpc("pos_sell_merchandise_stock", {
      p_product_id: claim.productId,
      p_qty: -claim.qty,
    });
    if (error) {
      console.error(
        `[pos] merch stock restore failed: product=${claim.productId} qty=${claim.qty}:`,
        error
      );
    }
  }
}

/**
 * Restore stok merchandise saat order dibatalkan: baris item ber-flag
 * inventory_deducted dikembalikan stoknya lalu flag dimatikan supaya
 * pembatalan ganda tidak mengembalikan stok dua kali.
 */
export async function restoreMerchandiseStockForOrder(
  db: DbClient,
  orderId: string
): Promise<void> {
  const { data: rows, error } = await db
    .from("pos_order_items")
    .select("id, product_id, quantity")
    .eq("order_id", orderId)
    .eq("inventory_deducted", true);

  if (error) {
    console.error(`[pos] merch cancel-restore load failed: order=${orderId}:`, error);
    return;
  }

  for (const row of (rows ?? []) as Array<{ id: string; product_id: string | null; quantity: number | null }>) {
    const qty = Number(row.quantity) || 0;
    if (!row.product_id || qty <= 0) continue;

    const { error: restoreError } = await db.rpc("pos_sell_merchandise_stock", {
      p_product_id: row.product_id,
      p_qty: -qty,
    });
    if (restoreError) {
      console.error(
        `[pos] merch cancel-restore failed: order=${orderId} product=${row.product_id}:`,
        restoreError
      );
      continue;
    }

    await db
      .from("pos_order_items")
      .update({ inventory_deducted: false })
      .eq("id", row.id);
  }
}

/** Ada item merchandise ber-stok di daftar? (guard fitur yang belum mendukung) */
export async function hasTrackedMerchandise(
  db: DbClient,
  items: Array<{ product_id?: string | null }>
): Promise<boolean> {
  const ids = Array.from(
    new Set(items.map((item) => String(item.product_id || "")).filter(Boolean))
  );
  if (ids.length === 0) return false;

  const { data, error } = await db
    .from("pos_products")
    .select("id")
    .in("id", ids)
    .eq("product_kind", "merchandise")
    .eq("inventory_tracking", true)
    .limit(1);

  if (error) {
    console.error("[pos] merch lookup failed:", error);
    return false;
  }
  return (data ?? []).length > 0;
}

async function resolveProductName(db: DbClient, productId: string): Promise<string> {
  const { data } = await db
    .from("pos_products")
    .select("name")
    .eq("id", productId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name || "produk";
}
