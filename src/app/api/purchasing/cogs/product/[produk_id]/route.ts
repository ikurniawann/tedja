import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, ApiError, successResponse } from "@/lib/api/auth";
import { getApiUserScope, isRowInBusinessScope } from "@/lib/api/scope";
import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";

type StockRow = {
  id: string;
  qty_onhand?: number | string | null;
  qty_on_order?: number | string | null;
  avg_cost?: number | string | null;
  material_type?: string | null;
  source_product_id?: string | null;
  konversi_factor?: number | string | null;
  satuan_kecil_id?: string | null;
  satuan_kecil_nama?: string | null;
  satuan_besar_nama?: string | null;
};

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeToSmallUnit(
  baseCost: number,
  konversiFactor?: number | string | null,
  satuanKecilId?: string | null
) {
  const factor = toNumber(konversiFactor);
  if (satuanKecilId && factor > 0) return baseCost / factor;
  return baseCost;
}

// GET /api/purchasing/cogs/product/:produk_id
// Real-time estimated COGS from product BOM + inventory stock.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ produk_id: string }> }
) {
  try {
    await requireApiUser();
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { produk_id } = await params;

    if (!z.string().uuid().safeParse(produk_id).success) {
      throw ApiError.badRequest("Invalid product ID");
    }

    const { data: product, error: productError } = await db
      .from("v_products_cogs")
      .select("*")
      .eq("id", produk_id)
      .eq("is_active", true)
      .single();

    if (productError || !product) {
      throw ApiError.notFound("Product not found");
    }

    if (
      !isRowInBusinessScope(scope, {
        company_id: product.company_id,
        branch_id: product.branch_id,
      })
    ) {
      throw ApiError.notFound("Product not found");
    }

    const { data: bomItems, error: bomError } = await db
      .from("bom_items", MANUFACTURING_SCHEMA)
      .select(`
        *,
        raw_material:raw_materials!raw_material_id(id, kode, nama, material_type, source_product_id),
        satuan:units!satuan_id(id, kode, nama)
      `)
      .eq("product_id", produk_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (bomError) throw bomError;

    if (!bomItems || bomItems.length === 0) {
      return successResponse({
        produk_id: product.id,
        kode: product.kode,
        nama: product.nama,
        satuan: product.satuan_nama,
        harga_jual: product.harga_jual,
        hpp_per_unit: 0,
        total_bom_cost: 0,
        total_overhead: 0,
        breakdown_bahan: [],
        stock_warnings: [],
        warning: "This product does not have a bill of materials yet",
      });
    }

    const materialIds = Array.from(
      new Set(bomItems.map((item) => item.raw_material_id).filter(Boolean))
    );

    const { data: stockRows, error: stockError } = materialIds.length > 0
      ? await db
          .from("v_raw_materials_stock")
          .select(
            "id, qty_onhand, qty_on_order, avg_cost, material_type, source_product_id, konversi_factor, satuan_kecil_id, satuan_kecil_nama, satuan_besar_nama"
          )
          .in("id", materialIds)
      : { data: [], error: null };

    if (stockError) throw stockError;

    const stockByMaterialId = new Map<string, StockRow>(
      (stockRows || []).map((stock) => [stock.id, stock as StockRow])
    );

    const { data: settings } = await db
      .from("settings")
      .select("value")
      .eq("key", "overhead_rate")
      .maybeSingle();

    const overheadRate = settings?.value ? toNumber(settings.value) / 100 : 0.1;

    let totalBomCost = 0;
    const breakdownBahan = bomItems.map((bom) => {
      const stock = stockByMaterialId.get(bom.raw_material_id);
      const qtyRequired = toNumber(bom.qty_required);
      const wasteFactor = toNumber(bom.waste_factor);
      const effectiveQty = qtyRequired * (1 + wasteFactor);
      const unitCost = normalizeToSmallUnit(
        toNumber(stock?.avg_cost),
        stock?.konversi_factor,
        stock?.satuan_kecil_id
      );
      const subtotal = effectiveQty * unitCost;
      totalBomCost += subtotal;

      return {
        bahan_id: bom.raw_material_id,
        kode: bom.raw_material?.kode || "",
        nama: bom.raw_material?.nama || "",
        material_type: bom.raw_material?.material_type || stock?.material_type || "PURCHASED",
        source_product_id: bom.raw_material?.source_product_id || stock?.source_product_id || null,
        jumlah: qtyRequired,
        satuan:
          bom.satuan?.nama ||
          stock?.satuan_kecil_nama ||
          stock?.satuan_besar_nama ||
          "-",
        qty_available: toNumber(stock?.qty_onhand),
        qty_on_order: toNumber(stock?.qty_on_order),
        unit_cost: unitCost,
        waste_percentage: wasteFactor * 100,
        effective_qty: Math.round(effectiveQty * 1000) / 1000,
        subtotal: Math.round(subtotal * 100) / 100,
      };
    });

    const totalOverhead = totalBomCost * overheadRate;
    const hppPerUnit = Math.round((totalBomCost + totalOverhead) * 100) / 100;
    const totalBomCostRounded = Math.round(totalBomCost * 100) / 100;
    const totalOverheadRounded = Math.round(totalOverhead * 100) / 100;

    const hargaJual = toNumber(product.harga_jual);
    const margin = hargaJual > 0 ? hargaJual - hppPerUnit : null;
    const marginPct =
      margin !== null && hargaJual > 0
        ? Math.round((margin / hargaJual) * 10000) / 100
        : null;

    const stockWarnings = breakdownBahan
      .filter((item) => item.jumlah > 0 && item.qty_available < item.jumlah * 10)
      .map((item) => ({
        nama: item.nama,
        qty_available: item.qty_available,
        required_per_unit: item.jumlah,
        stock_coverage_units: Math.round((item.qty_available / item.jumlah) * 10) / 10,
      }));

    return successResponse({
      produk_id: product.id,
      kode: product.kode,
      nama: product.nama,
      satuan: product.satuan_nama,
      harga_jual: product.harga_jual,
      hpp_per_unit: hppPerUnit,
      total_bom_cost: totalBomCostRounded,
      overhead_rate: overheadRate * 100,
      total_overhead: totalOverheadRounded,
      breakdown_bahan: breakdownBahan,
      margin_vs_harga_jual: margin,
      margin_percentage: marginPct,
      margin_label:
        marginPct === null
          ? null
          : marginPct > 30
            ? "Healthy"
            : marginPct > 15
              ? "Acceptable"
              : "Thin",
      stock_warnings: stockWarnings,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    if (error instanceof z.ZodError) {
      return ApiError.badRequest("Invalid params", error.issues).toResponse();
    }
    console.error("Error calculating product COGS:", error);
    return ApiError.server("Failed to calculate estimated COGS").toResponse();
  }
}
