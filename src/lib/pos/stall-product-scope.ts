import { query } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import { loadUserWarehouses } from "@/lib/users/user-warehouses";

export type StallProductScope =
  | { mode: "all" }
  | { mode: "none" }
  | { mode: "ids"; productIds: string[]; warehouseIds: string[] };

/**
 * Resolve which POS products a logged-in user may sell.
 * Stall admins: only products whose purchasing `warehouse_id` is in user_warehouses.
 * Super / unscoped: all products.
 * Branch user without stall assignment: none (empty catalog).
 */
export async function resolvePosProductStallScope(
  scope: UserScope | null
): Promise<StallProductScope> {
  if (!scope || scope.isUnscoped || scope.role === "super_admin") {
    return { mode: "all" };
  }

  const warehouses = await loadUserWarehouses(scope.userId);
  const warehouseIds = warehouses.map((row) => row.warehouse_id);

  if (warehouseIds.length === 0) {
    return { mode: "none" };
  }

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

  return {
    mode: "ids",
    productIds: rows.map((row) => row.id),
    warehouseIds,
  };
}

export function applyStallScopeToProductIds(
  scopeResult: StallProductScope
): string[] | null {
  if (scopeResult.mode === "all") return null;
  if (scopeResult.mode === "none") return [];
  return scopeResult.productIds;
}
