// ============================================
// API ROUTE: /api/purchasing/raw-materials/[id]/purchase-price
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getErrorMessage } from "../../_helpers";
import { getApiUserScope, isRowInBusinessScope } from "@/lib/api/scope";
import { getPurchasePriceSuggestions } from "@/lib/purchasing/purchase-price";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get("supplier_id");
    const satuanId = searchParams.get("satuan_id");
    const monthsParam = parseInt(searchParams.get("months") || "24", 10);
    const months = Number.isFinite(monthsParam) ? Math.max(1, monthsParam) : 24;

    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: material, error: materialError } = await db
      .from("raw_materials")
      .select("id, company_id, branch_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (materialError || !material) {
      return Response.json(
        { success: false, message: "Bahan baku tidak ditemukan" },
        { status: 404 }
      );
    }

    if (
      !isRowInBusinessScope(scope, {
        company_id: material.company_id,
        branch_id: material.branch_id,
      })
    ) {
      return Response.json(
        { success: false, message: "Bahan baku tidak ditemukan" },
        { status: 404 }
      );
    }

    const [suggestion] = await getPurchasePriceSuggestions(
      db,
      [{ raw_material_id: id, satuan_id: satuanId }],
      { supplierId, months }
    );

    return Response.json({ success: true, data: suggestion ?? null });
  } catch (error: unknown) {
    console.error("Error fetching raw material purchase price:", error);
    return Response.json(
      {
        success: false,
        message: getErrorMessage(error, "Gagal mengambil harga pembelian terakhir"),
      },
      { status: 500 }
    );
  }
}
