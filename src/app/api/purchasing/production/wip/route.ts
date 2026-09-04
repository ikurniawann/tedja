import { NextResponse } from "next/server";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import { PRODUCTION_API_ROLES } from "@/lib/manufacturing/constants";
import { createPgClient } from "@/lib/pg/create-client";
import {
  branchScopeOr,
  companyScopeOr,
  getApiUserScope,
} from "@/lib/api/scope";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

type WipStockRow = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  satuan_besar_nama?: string | null;
  qty_onhand?: number | string | null;
  qty_on_order?: number | string | null;
  avg_cost?: number | string | null;
  status_stok?: string | null;
  material_type?: string | null;
  source_product_id?: string | null;
};

type SourceProductRow = {
  id: string;
  kode?: string | null;
  nama?: string | null;
  kategori?: string | null;
  harga_jual?: number | string | null;
};

type BatchRow = {
  id: string;
  product_id: string;
  wip_raw_material_id?: string | null;
  batch_number?: string | null;
  qty_produced?: number | string | null;
  hpp_per_unit?: number | string | null;
  total_cost?: number | string | null;
  created_at?: string | null;
  production_order_id?: string | null;
  production_order?: {
    id?: string | null;
    nomor_produksi?: string | null;
    status?: string | null;
  } | null;
};

export async function GET() {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = createPgClient();
    const scope = await getApiUserScope();

    const { view: stockView, warehouseId } = await rawMaterialStockSource();
    let wipQuery = db
      .from(stockView)
      .select("*")
      .eq("material_type", "WIP")
      .is("deleted_at", null);
    if (warehouseId) wipQuery = wipQuery.eq("warehouse_id", warehouseId);
    const companyOr = companyScopeOr(scope);
    if (companyOr) wipQuery = wipQuery.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) wipQuery = wipQuery.or(branchOr);

    const { data: wipRows, error: wipError } = await wipQuery.order("nama", {
      ascending: true,
    });

    if (wipError) throw wipError;

    const rows = (wipRows || []) as WipStockRow[];
    const sourceProductIds = Array.from(new Set(rows.map((row) => row.source_product_id).filter(Boolean))) as string[];
    const materialIds = rows.map((row) => row.id);

    const [{ data: sourceProducts, error: sourceProductError }, { data: batches, error: batchError }] =
      await Promise.all([
        sourceProductIds.length > 0
          ? db
              .from("products")
              .select("id,kode,nama,kategori,harga_jual")
              .in("id", sourceProductIds)
          : Promise.resolve({ data: [], error: null }),
        materialIds.length > 0
          ? db
              .from("production_batches")
              .select(`
                id,
                product_id,
                wip_raw_material_id,
                batch_number,
                qty_produced,
                hpp_per_unit,
                total_cost,
                created_at,
                production_order_id,
                production_order:production_orders!production_order_id(id,nomor_produksi,status)
              `)
              .eq("output_type", "WIP")
              .in("wip_raw_material_id", materialIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (sourceProductError) throw sourceProductError;
    if (batchError) throw batchError;

    const sourceProductMap = new Map((sourceProducts || []).map((product) => [product.id, product as SourceProductRow]));
    const batchMap = new Map<string, BatchRow>();
    ((batches || []) as unknown as BatchRow[]).forEach((batch) => {
      if (batch.wip_raw_material_id && !batchMap.has(batch.wip_raw_material_id)) {
        batchMap.set(batch.wip_raw_material_id, batch);
      }
    });

    const data = rows.map((row) => {
      const latestBatch = batchMap.get(row.id) || null;
      const sourceProduct = row.source_product_id ? sourceProductMap.get(row.source_product_id) || null : null;

      return {
        id: row.id,
        kode: row.kode || "",
        nama: row.nama || row.id,
        kategori: row.kategori || "-",
        satuan: row.satuan_besar_nama || "",
        qty_onhand: toNumber(row.qty_onhand),
        qty_on_order: toNumber(row.qty_on_order),
        avg_cost: toNumber(row.avg_cost),
        status_stok: row.status_stok || "HABIS",
        source_product_id: row.source_product_id,
        source_product: sourceProduct,
        latest_batch: latestBatch
          ? {
              id: latestBatch.id,
              batch_number: latestBatch.batch_number,
              qty_produced: toNumber(latestBatch.qty_produced),
              hpp_per_unit: toNumber(latestBatch.hpp_per_unit),
              total_cost: toNumber(latestBatch.total_cost),
              created_at: latestBatch.created_at,
              production_order_id: latestBatch.production_order_id,
              production_order_number: latestBatch.production_order?.nomor_produksi || null,
              production_order_status: latestBatch.production_order?.status || null,
            }
          : null,
      };
    });

    const summary = data.reduce(
      (acc, item) => {
        acc.total_wip += 1;
        acc.total_qty += item.qty_onhand;
        acc.total_value += item.qty_onhand * item.avg_cost;
        if (item.qty_onhand > 0) acc.ready_wip += 1;
        return acc;
      },
      { total_wip: 0, ready_wip: 0, total_qty: 0, total_value: 0 }
    );

    return NextResponse.json({ success: true, data, summary });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching WIP inventory:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Gagal mengambil inventory WIP" },
      { status: 500 }
    );
  }
}
