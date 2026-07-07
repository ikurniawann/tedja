import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser, ApiError, successResponse } from "@/lib/api/auth";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

// GET /api/purchasing/cogs/raw-material/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireApiUser();
    const db = await createServerPgClient();
    const { id } = await params;

    if (!z.string().uuid().safeParse(id).success) {
      throw ApiError.badRequest("Invalid raw material ID");
    }

    const { data: material, error: materialError } = await db
      .from("v_raw_materials_stock")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (materialError || !material) {
      throw ApiError.notFound("Raw material not found");
    }

    const { data: bomItems, error: bomError } = await db
      .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
      .select(`
        *,
        component:raw_materials!component_raw_material_id(id, kode, nama, material_type),
        satuan:units!satuan_id(id, kode, nama)
      `)
      .eq("output_raw_material_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (bomError) throw bomError;

    if (!bomItems || bomItems.length === 0) {
      return successResponse({
        raw_material_id: material.id,
        kode: material.kode,
        nama: material.nama,
        hpp_per_unit: 0,
        total_bom_cost: 0,
        total_overhead: 0,
        breakdown_bahan: [],
        warning: "This raw material does not have a bill of materials yet",
      });
    }

    const componentIds = Array.from(
      new Set(bomItems.map((item) => item.component_raw_material_id).filter(Boolean))
    );

    const { data: stockRows, error: stockError } = componentIds.length > 0
      ? await db
          .from("v_raw_materials_stock")
          .select(
            "id, qty_onhand, qty_on_order, avg_cost, material_type, satuan_kecil_nama, satuan_besar_nama"
          )
          .in("id", componentIds)
      : { data: [], error: null };

    if (stockError) throw stockError;

    const stockByMaterialId = new Map(
      (stockRows || []).map((stock) => [stock.id, stock])
    );

    const { data: settings } = await db
      .from("settings")
      .select("value")
      .eq("key", "overhead_rate")
      .maybeSingle();

    const overheadRate = settings?.value ? toNumber(settings.value) / 100 : 0.1;

    let totalBomCost = 0;
    const breakdownBahan = bomItems.map((bom) => {
      const stock = stockByMaterialId.get(bom.component_raw_material_id);
      const qtyRequired = toNumber(bom.qty_required);
      const wasteFactor = toNumber(bom.waste_factor);
      const effectiveQty = qtyRequired * (1 + wasteFactor);
      const unitCost = toNumber(stock?.avg_cost);
      const subtotal = effectiveQty * unitCost;
      totalBomCost += subtotal;

      return {
        bahan_id: bom.component_raw_material_id,
        kode: bom.component?.kode || "",
        nama: bom.component?.nama || "",
        material_type: bom.component?.material_type || stock?.material_type || "PURCHASED",
        jumlah: qtyRequired,
        satuan:
          bom.satuan?.nama ||
          (stock as { satuan_kecil_nama?: string | null } | undefined)?.satuan_kecil_nama ||
          (stock as { satuan_besar_nama?: string | null } | undefined)?.satuan_besar_nama ||
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

    return successResponse({
      raw_material_id: material.id,
      kode: material.kode,
      nama: material.nama,
      hpp_per_unit: hppPerUnit,
      total_bom_cost: Math.round(totalBomCost * 100) / 100,
      overhead_rate: overheadRate * 100,
      total_overhead: Math.round(totalOverhead * 100) / 100,
      breakdown_bahan: breakdownBahan,
    });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error calculating raw material COGS:", error);
    return ApiError.server("Failed to calculate estimated COGS").toResponse();
  }
}
