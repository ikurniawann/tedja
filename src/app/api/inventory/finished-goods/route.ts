import { NextRequest } from "next/server";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import { createServerPgClient } from "@/lib/pg/create-client";
import { paginatedResponse } from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";

export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "";
    // "all" = permintaan eksplisit semua gudang; selain itu ikut stall aktif.
    const warehouseParam = searchParams.get("warehouse_id") || "";
    const warehouseId =
      warehouseParam === "all"
        ? "all"
        : (await resolveWarehouseFilter(warehouseParam)) ?? "";
    const page = Number(searchParams.get("page") || 1);
    const limit = Number(searchParams.get("limit") || 20);
    const offset = (page - 1) * limit;

    let query = db
      .from("v_finished_goods_stock")
      .select("*", { count: "exact" })
      .order("product_nama", { ascending: true })
      .range(offset, offset + limit - 1);

    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (search) {
      query = query.or(
        `product_nama.ilike.%${search}%,product_kode.ilike.%${search}%`
      );
    }
    if (status === "out_of_stock") query = query.lte("qty_available", 0);
    if (status === "in_stock") query = query.gt("qty_available", 0);
    if (warehouseId && warehouseId !== "all") {
      query = query.eq("warehouse_id", warehouseId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return paginatedResponse(
      data || [],
      { page, limit, total: count || 0 },
      "Finished goods stock retrieved"
    );
  } catch (e: any) {
    console.error("Error fetching finished goods stock:", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
