// ============================================
// API ROUTE: /api/purchasing/reports/inventory-valuation
// ============================================

import { createServerPgClient } from "@/lib/pg/create-client";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

// GET /api/purchasing/reports/inventory-valuation
export async function GET() {
  try {
    const db = await createServerPgClient();

    // Get semua inventory aktif dengan stok > 0
    const { view: stockView, warehouseId } = await rawMaterialStockSource();
    let valuationQuery = db
      .from(stockView)
      .select("*")
      .eq("is_active", true);
    if (warehouseId) valuationQuery = valuationQuery.eq("warehouse_id", warehouseId);

    const { data, error } = await valuationQuery.order("kategori", {
      ascending: true,
    });

    if (error) throw error;

    // Calculate total value
    let totalValue = 0;
    const byCategory: Record<string, { kategori: string; total_value: number; item_count: number }> = {};

    const normalizedData = (data || []).map((item) => {
      const qty = toNumber(item.qty_onhand);
      const avgCost = toNumber(item.avg_cost ?? item.unit_cost);
      return {
        ...item,
        qty_onhand: qty,
        min_stock: toNumber(item.min_stock ?? item.stok_minimum),
        max_stock: item.max_stock ?? item.stok_maximum ?? null,
        avg_cost: avgCost,
        unit_cost: avgCost,
        total_value: qty * avgCost,
        satuan: item.satuan || item.satuan_besar_nama || "",
        lokasi_rak: item.lokasi_rak || "-",
      };
    });

    normalizedData.forEach((item) => {
      const value = item.total_value;
      totalValue += value;

      if (!byCategory[item.kategori]) {
        byCategory[item.kategori] = {
          kategori: item.kategori,
          total_value: 0,
          item_count: 0,
        };
      }
      byCategory[item.kategori].total_value += value;
      byCategory[item.kategori].item_count += 1;
    });

    const kategoriLabels: Record<string, string> = {
      BAHAN_PANGAN: "Bahan Pangan",
      BAHAN_NON_PANGAN: "Bahan Non-Pangan",
      KEMASAN: "Kemasan",
      BAHAN_BAKAR: "Bahan Bakar",
      LAINNYA: "Lainnya",
    };

    return Response.json({
      success: true,
      data: normalizedData,
      summary: {
        total_value: totalValue,
        total_items: normalizedData.length,
        by_category: Object.values(byCategory).map((cat) => ({
          ...cat,
          kategori: kategoriLabels[cat.kategori] || cat.kategori,
        })),
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching inventory valuation:", error);
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "Gagal mengambil laporan valuasi" },
      { status: 500 }
    );
  }
}
