// ============================================
// API ROUTE: /api/purchasing/inventory/[id]
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { rawMaterialStockSource } from "@/lib/api/stall-scope";

// GET /api/purchasing/inventory/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await createServerPgClient();

    // Get inventory dengan detail bahan
    const { view: stockView, warehouseId } = await rawMaterialStockSource();
    let inventoryQuery = db.from(stockView).select("*").eq("id", id);
    if (warehouseId) inventoryQuery = inventoryQuery.eq("warehouse_id", warehouseId);
    const { data: inventory, error: invError } = await inventoryQuery.single();

    if (invError) {
      if (invError.code === "PGRST116") {
        return Response.json(
          { success: false, message: "Inventory tidak ditemukan" },
          { status: 404 }
        );
      }
      throw invError;
    }

    return Response.json({ success: true, data: inventory });
  } catch (error: any) {
    console.error("Error fetching inventory:", error);
    return Response.json(
      { success: false, message: error.message || "Gagal mengambil data inventory" },
      { status: 500 }
    );
  }
}
