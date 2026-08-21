import { NextRequest } from "next/server";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import { createServerPgClient } from "@/lib/pg/create-client";
import { paginatedResponse } from "@/lib/api/auth";
import {
  effectiveBranchId,
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  validateWarehouseForReceivingScope,
} from "@/lib/api/scope";
import {
  computeStockStatus,
  listRawMaterialStockByBranch,
  listRawMaterialStockByWarehouse,
  mapRawMaterialStockRow,
  type RawMaterialStockRow,
} from "@/lib/inventory/warehouse-stock";
import { z } from "zod";

const querySchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  warehouse_id: z.string().uuid().optional(),
});

function filterStockRows(
  rows: RawMaterialStockRow[],
  search?: string,
  status?: string
) {
  let filtered = rows;

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (row) =>
        row.material_nama.toLowerCase().includes(q) ||
        row.material_kode.toLowerCase().includes(q)
    );
  }

  if (status === "out_of_stock") {
    filtered = filtered.filter((row) => row.qty_onhand <= 0);
  } else if (status === "low_stock") {
    filtered = filtered.filter(
      (row) =>
        row.qty_onhand > 0 && computeStockStatus(row.qty_onhand, row.min_stock) === "MENIPIS"
    );
  } else if (status === "normal") {
    filtered = filtered.filter(
      (row) => computeStockStatus(row.qty_onhand, row.min_stock) === "AMAN"
    );
  }

  return filtered;
}

function paginateRows<T>(rows: T[], page: number, limit: number) {
  const total = rows.length;
  const offset = (page - 1) * limit;
  return {
    total,
    data: rows.slice(offset, offset + limit),
  };
}

export async function GET(request: NextRequest) {
  try {
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const { search, status, page, limit } = params;
    // Filter gudang eksplisit menang; selain itu ikut stall aktif di sidebar.
    const warehouseIdParam = await resolveWarehouseFilter(params.warehouse_id);

    if (warehouseIdParam) {
      const warehouseCheck = await validateWarehouseForReceivingScope(
        warehouseIdParam,
        scope,
        null
      );
      if ("error" in warehouseCheck) {
        return Response.json(
          { success: false, error: "Gudang tidak valid atau tidak diizinkan" },
          { status: 400 }
        );
      }

      const rows = filterStockRows(
        await listRawMaterialStockByWarehouse(warehouseIdParam),
        search,
        status
      );
      const { data, total } = paginateRows(rows, page, limit);

      return paginatedResponse(
        data.map(mapRawMaterialStockRow),
        { page, limit, total },
        "Raw material stock retrieved"
      );
    }

    const branchId = effectiveBranchId(scope);
    if (!branchId) {
      const db = await createServerPgClient();
      let legacyQuery = db
        .from("v_raw_materials_stock")
        .select("*", { count: "exact" })
        .is("deleted_at", null)
        .eq("is_active", true);

      const companyOr = companyScopeOr(scope);
      if (companyOr) legacyQuery = legacyQuery.or(companyOr);
      const branchOr = branchScopeOr(scope);
      if (branchOr) legacyQuery = legacyQuery.or(branchOr);

      if (search) {
        legacyQuery = legacyQuery.or(`nama.ilike.%${search}%,kode.ilike.%${search}%`);
      }
      if (status === "out_of_stock") {
        legacyQuery = legacyQuery.eq("status_stok", "HABIS");
      } else if (status === "low_stock") {
        legacyQuery = legacyQuery.eq("status_stok", "MENIPIS");
      } else if (status === "normal") {
        legacyQuery = legacyQuery.eq("status_stok", "AMAN");
      }

      const offset = (page - 1) * limit;
      const { data, error, count } = await legacyQuery
        .order("nama", { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return paginatedResponse(
        data || [],
        { page, limit, total: count || 0 },
        "Raw material stock retrieved"
      );
    }

    const rows = filterStockRows(
      await listRawMaterialStockByBranch(branchId),
      search,
      status
    );
    const { data, total } = paginateRows(rows, page, limit);

    return paginatedResponse(
      data.map(mapRawMaterialStockRow),
      { page, limit, total },
      "Raw material stock retrieved"
    );
  } catch (e: unknown) {
    console.error("Error fetching raw material stock:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
