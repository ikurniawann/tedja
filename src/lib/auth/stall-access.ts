import { query } from "@/lib/db";
import { sortWarehouses } from "@/lib/configuration/sort-warehouses";

export interface StallOption {
  id: string;
  name: string;
  code: string;
  is_default: boolean;
}

export interface StallAccess {
  /** true = boleh switch ke stall mana pun (termasuk "Semua Stall"). */
  allAccess: boolean;
  /** Stall yang boleh dipilih di switcher (sudah difilter & terurut). */
  stalls: StallOption[];
}

/**
 * Aturan switcher stall berbasis penempatan (configuration.user_warehouses):
 * - super_admin: bebas ke semua stall.
 * - User yang ditempatkan di Main Storage (warehouse is_default): bebas ke
 *   semua stall di branch-nya.
 * - User yang ditempatkan di stall tertentu: hanya boleh ke stall tempatnya.
 * - User tanpa penempatan: diperlakukan bebas (kompatibel dengan admin lama
 *   yang belum di-assign stall).
 */
export async function getStallAccess(
  userId: string,
  role: string | null,
  branchId: string | null
): Promise<StallAccess> {
  const assignments = await query<StallOption>(
    `SELECT w.id, w.name, w.code, w.is_default
     FROM configuration.user_warehouses uw
     JOIN configuration.warehouses w ON w.id = uw.warehouse_id AND w.is_active
     WHERE uw.user_id = $1 AND uw.is_active`,
    [userId]
  );

  const allAccess =
    role === "super_admin" ||
    assignments.length === 0 ||
    assignments.some((assignment) => assignment.is_default);

  if (!allAccess) {
    return { allAccess, stalls: sortWarehouses(assignments) };
  }

  const params: unknown[] = [];
  let where = "w.is_active";
  if (branchId) {
    params.push(branchId);
    where += ` AND w.branch_id = $${params.length}`;
  }

  const stalls = await query<StallOption>(
    `SELECT w.id, w.name, w.code, w.is_default
     FROM configuration.warehouses w
     WHERE ${where}`,
    params
  );

  return { allAccess, stalls: sortWarehouses(stalls) };
}
