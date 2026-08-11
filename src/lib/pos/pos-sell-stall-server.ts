import { query } from "@/lib/db";
import { resolveActiveStallFromCookies } from "@/lib/auth/active-stall";
import { getApiUserScope } from "@/lib/api/scope";
import { loadUserWarehouses } from "@/lib/users/user-warehouses";
import {
  assertProductWarehousesMatchStall,
  resolvePosSellStall,
  type PosSellStallResult,
} from "@/lib/pos/pos-sell-stall";

export async function resolvePosSellStallForUser(
  userId: string
): Promise<PosSellStallResult> {
  const [warehouses, activeStall, scope] = await Promise.all([
    loadUserWarehouses(userId),
    resolveActiveStallFromCookies(),
    getApiUserScope(),
  ]);

  const assignedIds = warehouses.map((row) => row.warehouse_id);
  const isUnscoped = !scope || scope.isUnscoped || scope.role === "super_admin";

  // Super/admin with cookie "all" or unset and no placement → cannot sell until they pick.
  // Unscoped with unset and zero assignments: treat as all_stalls if cookie is all/unset without single placement.
  let activeMode = activeStall.mode;
  let activeStallId: string | null =
    activeStall.mode === "stall" ? activeStall.stall.id : null;

  // Non-switcher users never read cookie in require-user historically; still honor cookie if present.
  if (activeStall.mode === "unset" && assignedIds.length === 0 && isUnscoped) {
    activeMode = "all";
  }

  const resolved = resolvePosSellStall({
    activeMode,
    activeStallId,
    assignedWarehouseIds: assignedIds,
  });

  if (!resolved.ok) return resolved;

  // Bound active stall to assignment when user is stall-scoped (not unscoped/admin free).
  if (!isUnscoped && assignedIds.length > 0 && !assignedIds.includes(resolved.warehouseId)) {
    return {
      ok: false,
      reason: "no_stall",
      message: "Stall aktif di luar penempatan Anda",
    };
  }

  return resolved;
}

/** Map POS product ids → purchasing warehouse_id (null if unlinked). */
export async function loadPosProductWarehouseIds(
  productIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const rows = await query<{ id: string; warehouse_id: string | null }>(
    `SELECT pp.id,
            COALESCE(
              p.warehouse_id,
              p_sku.warehouse_id
            ) AS warehouse_id
     FROM pos.pos_products pp
     LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
     LEFT JOIN item.products p_sku
       ON pp.source_product_id IS NULL
      AND pp.sku = ('PUR-' || p_sku.kode)
      AND p_sku.deleted_at IS NULL
      AND p_sku.kode IS NOT NULL
      AND btrim(p_sku.kode) <> ''
     WHERE pp.id = ANY($1::uuid[])`,
    [ids]
  );

  for (const row of rows) {
    map.set(row.id, row.warehouse_id);
  }
  for (const id of ids) {
    if (!map.has(id)) map.set(id, null);
  }
  return map;
}

export async function assertOrderItemsMatchSellStall(
  productIds: string[],
  stallId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const warehouseByProduct = await loadPosProductWarehouseIds(productIds);
  const warehouseIds = productIds.map((id) => warehouseByProduct.get(id) ?? null);
  return assertProductWarehousesMatchStall(warehouseIds, stallId);
}
