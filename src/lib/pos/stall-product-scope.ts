import { query } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import { getStallAccess } from "@/lib/auth/stall-access";
import { canSellMixedStall } from "@/lib/pos/central-cashier";
import type { ActiveStallMode } from "@/lib/pos/pos-sell-stall";
import {
  loadCentralCashierGate,
  resolvePosSellStallForUser,
} from "@/lib/pos/pos-sell-stall-server";

export type StallProductScope =
  | { mode: "all"; activeMode?: ActiveStallMode }
  | { mode: "none"; reason?: string; activeMode?: ActiveStallMode }
  | {
      mode: "ids";
      productIds: string[];
      warehouseIds: string[];
      activeMode?: ActiveStallMode;
    };

export async function loadProductIdsForWarehouses(
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
 * Default: single active sell stall (1 order = 1 stall).
 * Central cashier gate + mode "all" → union of all accessible stall catalogs.
 * Regular cashier in "Semua Stall" / no stall → empty catalog.
 */
export async function resolvePosProductStallScope(
  scope: UserScope | null
): Promise<StallProductScope> {
  if (!scope?.userId) {
    return { mode: "none", reason: "no_session" };
  }

  const gate = await loadCentralCashierGate({
    userId: scope.userId,
    role: scope.role,
  });

  if (
    canSellMixedStall({
      hasCentralMenu: gate.hasCentralMenu,
      canCentralCheckout: gate.canCentralCheckout,
      activeMode: gate.activeMode,
    })
  ) {
    const access = await getStallAccess(scope.userId, scope.role, scope.branchId);
    const warehouseIds = access.stalls.map((stall) => stall.id);
    const productIds = await loadProductIdsForWarehouses(warehouseIds);
    return { mode: "ids", productIds, warehouseIds, activeMode: gate.activeMode };
  }

  const sellStall = await resolvePosSellStallForUser(scope.userId);
  if (!sellStall.ok) {
    return { mode: "none", reason: sellStall.reason, activeMode: gate.activeMode };
  }

  const warehouseIds = [sellStall.warehouseId];
  const productIds = await loadProductIdsForWarehouses(warehouseIds);
  return { mode: "ids", productIds, warehouseIds, activeMode: gate.activeMode };
}

export function applyStallScopeToProductIds(
  scopeResult: StallProductScope
): string[] | null {
  if (scopeResult.mode === "all") return null;
  if (scopeResult.mode === "none") return [];
  return scopeResult.productIds;
}
