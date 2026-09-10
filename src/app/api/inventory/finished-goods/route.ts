import { NextRequest } from "next/server";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import { createServerPgClient } from "@/lib/pg/create-client";
import { paginatedResponse } from "@/lib/api/auth";
import { query as dbQuery } from "@/lib/db";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";
import type { ProductStockVariant } from "@/features/inventory/stock/types";

type FinishedGoodsRow = { product_id?: string | null; [key: string]: unknown };

type VariantRow = {
  product_id: string;
  sku_id: string;
  sku: string;
  name: string;
  options: unknown;
  stock_quantity: number | string | null;
};

/**
 * EPIC-047 Fase 1C — satu query tambahan ber-parameter untuk mengambil SKU
 * aktif per produk merchandise di halaman ini saja (bukan mengubah view
 * `v_finished_goods_stock`). Produk tanpa SKU (F&B) tidak kena query ini
 * sama sekali karena JOIN ke pos_product_skus.
 */
async function loadVariantsByProductId(
  productIds: string[]
): Promise<Map<string, ProductStockVariant[]>> {
  const byProduct = new Map<string, ProductStockVariant[]>();
  if (productIds.length === 0) return byProduct;

  const rows = await dbQuery<VariantRow>(
    `SELECT sp.source_product_id AS product_id,
            sk.id AS sku_id,
            sk.sku,
            sk.name,
            sk.options,
            sk.stock_quantity
       FROM pos.pos_products sp
       JOIN pos.pos_product_skus sk ON sk.product_id = sp.id AND sk.is_active = true
      WHERE sp.product_kind = 'merchandise'
        AND sp.source_product_id = ANY($1::uuid[])
      ORDER BY sk.sku ASC`,
    [productIds]
  );

  for (const row of rows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push({
      sku_id: row.sku_id,
      sku: row.sku,
      name: row.name,
      options: (row.options ?? null) as Record<string, string> | null,
      stock_quantity: Number(row.stock_quantity) || 0,
    });
    byProduct.set(row.product_id, list);
  }
  return byProduct;
}

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

    const rows = (data || []) as FinishedGoodsRow[];
    const productIds = Array.from(
      new Set(
        rows
          .map((row) => row.product_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    const variantsByProduct = await loadVariantsByProductId(productIds);
    const rowsWithVariants = rows.map((row) => {
      const variants = row.product_id ? variantsByProduct.get(row.product_id) ?? [] : [];
      return { ...row, variants, variant_count: variants.length };
    });

    return paginatedResponse(
      rowsWithVariants,
      { page, limit, total: count || 0 },
      "Finished goods stock retrieved"
    );
  } catch (e: unknown) {
    console.error("Error fetching finished goods stock:", e);
    const message = e instanceof Error ? e.message : "Failed to fetch finished goods stock";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
