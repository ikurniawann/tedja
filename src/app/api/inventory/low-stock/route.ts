import { NextRequest } from "next/server";
import { createPgClient } from "@/lib/pg/create-client";
import { paginatedResponse, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";

// GET /api/purchasing/reports/low-stock
export async function GET(request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.itemsInventory);
    
    const db = createPgClient();
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "";
    const status = searchParams.get("status") || ""; // out_of_stock | low_stock

    // Query inventory - simple version without complex supplier join
    let query = db
      .from("v_inventory")
      .select("*")
      .or(`stock_status.eq.out_of_stock,stock_status.eq.low_stock`)
      .order("qty_available", { ascending: true });

    if (category && category !== "all") {
      query = query.eq("material_kategori", category);
    }

    if (status === "out_of_stock") {
      query = query.eq("stock_status", "out_of_stock");
    } else if (status === "low_stock") {
      query = query.eq("stock_status", "low_stock");
    }

    const { data, error } = await query;
    if (error) throw error;

    // Transform data dengan calculated fields
    const transformedData = (data || []).map((item: any) => {
      const shortage = Math.max(0, item.qty_minimum - item.qty_available);
      const suggestedOrderQty = shortage > 0 ? Math.ceil(shortage * 1.5) : item.qty_minimum; // 1.5x safety stock
      const estimatedCost = suggestedOrderQty * (item.unit_cost || 0);

      return {
        id: item.id,
        material_kode: item.material_kode,
        material_nama: item.material_nama,
        kategori: item.material_kategori,
        qty_available: item.qty_available,
        qty_minimum: item.qty_minimum,
        qty_maximum: item.qty_maximum,
        unit_cost: item.unit_cost,
        satuan: item.satuan,
        stock_status: item.stock_status,
        shortage_qty: shortage,
        suggested_order_qty: suggestedOrderQty,
        estimated_cost: estimatedCost,
        supplier_name: undefined, // Will be fetched separately if needed
      };
    });

    return paginatedResponse(transformedData, { 
      page: 1, 
      limit: transformedData.length, 
      total: transformedData.length 
    }, "Low stock report retrieved");

  } catch (e: any) {
    console.error("Error fetching low stock report:", e);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
