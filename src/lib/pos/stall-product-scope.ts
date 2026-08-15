import { query } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import { resolvePosSellScopeForUser } from "@/lib/pos/pos-sell-stall-server";

export type StallProductScope =
  | { mode: "all" }
  | { mode: "none"; reason?: string }
  | { mode: "ids"; productIds: string[]; warehouseIds: string[] };

async function loadProductIdsForWarehouses(
  warehouseIds: string[]
): Promise<string[]> {
  if (warehouseIds.length === 0) return [];
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT pp.id
     FROM pos.pos_products pp
     INNER JOIN item.products p ON p.id = pp.source_product_id
     WHERE p.warehouse_id = ANY($1::uuid[])
       AND p.deleted_at IS NULL
       AND p.is_active = true
     UNION
     SELECT DISTINCT pp.id
     FROM pos.pos_products pp
     INNER JOIN item.products p
       ON pp.sku = ('PUR-' || p.kode)
     WHERE pp.source_product_id IS NULL
       AND p.warehouse_id = ANY($1::uuid[])
       AND p.deleted_at IS NULL
       AND p.is_active = true
       AND p.kode IS NOT NULL
       AND btrim(p.kode) <> ''`,
    [warehouseIds]
  );
  return rows.map((row) => row.id);
}

/**
 * Resolve which POS products a logged-in user may sell.
 * Stall tunggal → katalog stall itu. Mode "Semua Stall" (user akses penuh,
 * owner 2026-08-16) → seluruh katalog, transaksi boleh lintas stall.
 */
export async function resolvePosProductStallScope(
  scope: UserScope | null
): Promise<StallProductScope> {
  if (!scope?.userId) {
    return { mode: "none", reason: "no_session" };
  }

  const sellScope = await resolvePosSellScopeForUser(scope.userId);
  if (sellScope.mode === "blocked") {
    return { mode: "none", reason: sellScope.reason };
  }
  if (sellScope.mode === "all") {
    return { mode: "all" };
  }

  const warehouseIds = [sellScope.warehouseId];
  const productIds = await loadProductIdsForWarehouses(warehouseIds);
  return { mode: "ids", productIds, warehouseIds };
}

export function applyStallScopeToProductIds(
  scopeResult: StallProductScope
): string[] | null {
  if (scopeResult.mode === "all") return null;
  if (scopeResult.mode === "none") return [];
  return scopeResult.productIds;
}
