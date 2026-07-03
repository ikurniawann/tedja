import { createPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiRole, ApiError, successResponse } from "@/lib/api/auth";

// GET /api/purchasing/po-items?po_id=xxx
export async function GET(request: NextRequest) {
  try {
    await requireApiRole([
      "warehouse_staff",
      "warehouse_admin",
      "purchasing_admin",
      "purchasing_staff",
      "admin",
    ]);

    const db = createPgClient();
    const { searchParams } = new URL(request.url);
    const poId = searchParams.get("po_id");

    if (!poId) {
      return ApiError.badRequest("po_id parameter required").toResponse();
    }

    const { data, error } = await db
      .from("purchase_order_items")
      .select(`
        *,
        raw_material:raw_material_id(id, nama, kode),
        product:product_id(id, nama, kode),
        satuan:satuan_id(id, nama, nama_satuan)
      `)
      .eq("purchase_order_id", poId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return successResponse(data || [], "PO items retrieved");
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching PO items:", error);
    return ApiError.server("Failed to fetch PO items").toResponse();
  }
}
