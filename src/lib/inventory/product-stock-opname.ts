import { query, queryOne } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import { effectiveBranchId, effectiveCompanyId } from "@/lib/api/scope";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ProductOpnamePreviewLine {
  inventory_id: string | null;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  unit_cost: number;
}

type PgClient = Awaited<
  ReturnType<typeof import("@/lib/pg/create-client").createServerPgClient>
>;

function buildProductScopeFilter(
  scope: UserScope | null,
  alias = "p",
  startIdx = 1
): { sql: string; values: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  if (scope && !scope.isUnscoped) {
    if (scope.businessScope === "branch" && scope.branchId) {
      conditions.push(`${alias}.branch_id = $${idx++}`);
      values.push(scope.branchId);
    } else if (scope.companyId) {
      conditions.push(`${alias}.company_id = $${idx++}`);
      values.push(scope.companyId);
    }
  }

  return {
    sql: conditions.length ? conditions.join(" AND ") : "1=1",
    values,
    nextIdx: idx,
  };
}

function buildOpnameScopeFilter(
  scope: UserScope | null,
  alias = "pso",
  startIdx = 1
): { sql: string; values: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  if (scope && !scope.isUnscoped) {
    if (scope.businessScope === "branch" && scope.branchId) {
      conditions.push(`${alias}.branch_id = $${idx++}`);
      values.push(scope.branchId);
    } else if (scope.companyId) {
      conditions.push(`${alias}.company_id = $${idx++}`);
      values.push(scope.companyId);
    }
  }

  return {
    sql: conditions.length ? conditions.join(" AND ") : "1=1",
    values,
    nextIdx: idx,
  };
}

/** Semua produk aktif dalam scope + stok sistem dari finished_goods_inventory. */
export async function listProductInventoryForOpname(
  scope: UserScope | null
): Promise<ProductOpnamePreviewLine[]> {
  const productScope = buildProductScopeFilter(scope, "p", 1);

  const rows = await query<{
    inventory_id: string | null;
    product_id: string;
    product_kode: string;
    product_nama: string;
    satuan: string | null;
    qty_system: number | string | null;
    unit_cost: number | string | null;
  }>(
    `SELECT p.id AS product_id,
            fgi.id AS inventory_id,
            p.kode AS product_kode,
            p.nama AS product_nama,
            u.nama AS satuan,
            COALESCE(fgi.qty_available, 0) AS qty_system,
            COALESCE(NULLIF(fgi.unit_cost, 0), p.harga_modal, 0) AS unit_cost
     FROM products p
     LEFT JOIN inventory.finished_goods_inventory fgi
       ON fgi.product_id = p.id AND fgi.is_active = true
     LEFT JOIN units u ON u.id = p.satuan_id
     WHERE p.deleted_at IS NULL
       AND p.is_active = true
       AND ${productScope.sql}
     ORDER BY p.nama ASC`,
    productScope.values
  );

  return rows.map((row) => ({
    inventory_id: row.inventory_id,
    product_id: row.product_id,
    product_kode: row.product_kode,
    product_nama: row.product_nama,
    satuan: row.satuan,
    qty_system: toNumber(row.qty_system),
    unit_cost: toNumber(row.unit_cost),
  }));
}

export async function ensureProductInventoryId(
  db: PgClient,
  params: {
    productId: string;
    unitCost: number;
    userId: string;
  }
): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id
     FROM inventory.finished_goods_inventory
     WHERE product_id = $1
       AND is_active = true
     LIMIT 1`,
    [params.productId]
  );
  if (existing?.id) return existing.id;

  const { data, error } = await db
    .from("finished_goods_inventory")
    .insert({
      product_id: params.productId,
      qty_available: 0,
      unit_cost: params.unitCost,
      is_active: true,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select("id")
    .single();

  if (error || !data?.id) throw error ?? new Error("Gagal membuat record stok produk");
  return data.id as string;
}

export async function fetchProductStockOpnameDetail(id: string) {
  const header = await queryOne<{
    id: string;
    opname_number: string;
    company_id: string | null;
    branch_id: string | null;
    opname_date: string;
    status: string;
    reason: string;
    notes: string | null;
    total_lines: number;
    lines_counted: number;
    lines_with_variance: number;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
    branch_name: string | null;
    branch_code: string | null;
  }>(
    `SELECT pso.*,
            b.name AS branch_name,
            b.code AS branch_code
     FROM inventory.product_stock_opnames pso
     LEFT JOIN configuration.branches b ON b.id = pso.branch_id
     WHERE pso.id = $1`,
    [id]
  );

  if (!header) return null;

  const lines = await query<{
    id: string;
    product_stock_opname_id: string;
    inventory_id: string;
    product_id: string;
    qty_system: number | string;
    qty_counted: number | string | null;
    qty_variance: number | string | null;
    unit_cost: number | string | null;
    notes: string | null;
    product_kode: string | null;
    product_nama: string | null;
    satuan: string | null;
  }>(
    `SELECT psol.*,
            p.kode AS product_kode,
            p.nama AS product_nama,
            u.nama AS satuan
     FROM inventory.product_stock_opname_lines psol
     JOIN products p ON p.id = psol.product_id
     LEFT JOIN units u ON u.id = p.satuan_id
     WHERE psol.product_stock_opname_id = $1
     ORDER BY p.nama ASC`,
    [id]
  );

  return {
    id: header.id,
    opname_number: header.opname_number,
    company_id: header.company_id,
    branch_id: header.branch_id,
    opname_date: header.opname_date,
    status: header.status,
    reason: header.reason,
    notes: header.notes,
    total_lines: header.total_lines,
    lines_counted: header.lines_counted,
    lines_with_variance: header.lines_with_variance,
    completed_at: header.completed_at,
    created_at: header.created_at,
    updated_at: header.updated_at,
    branch: header.branch_id
      ? {
          id: header.branch_id,
          name: header.branch_name || "—",
          code: header.branch_code || "",
        }
      : null,
    lines: lines.map((line) => ({
      id: line.id,
      product_stock_opname_id: line.product_stock_opname_id,
      inventory_id: line.inventory_id,
      product_id: line.product_id,
      qty_system: toNumber(line.qty_system),
      qty_counted:
        line.qty_counted === null || line.qty_counted === undefined
          ? null
          : toNumber(line.qty_counted),
      qty_variance:
        line.qty_variance === null || line.qty_variance === undefined
          ? null
          : toNumber(line.qty_variance),
      unit_cost: toNumber(line.unit_cost),
      notes: line.notes,
      product_kode: line.product_kode,
      product_nama: line.product_nama,
      satuan: line.satuan,
    })),
  };
}

export function resolveOpnameScopeIds(scope: UserScope | null) {
  return {
    companyId: effectiveCompanyId(scope),
    branchId: effectiveBranchId(scope),
  };
}

export { buildOpnameScopeFilter };
