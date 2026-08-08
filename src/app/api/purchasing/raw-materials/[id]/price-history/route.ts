// ============================================
// API ROUTE: /api/purchasing/raw-materials/[id]/price-history
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { getErrorMessage, throwIfDbError } from "../../_helpers";
import { getApiUserScope, isRowInBusinessScope } from "@/lib/api/scope";

const PURCHASE_REFERENCE_TYPES = ["grn", "import"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const months = Math.max(1, parseInt(searchParams.get("months") || "12", 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    const { data: material, error: materialError } = await db
      .from("raw_materials")
      .select(
        "id, kode, nama, company_id, branch_id, satuan_besar_id, satuan_kecil_id, konversi_factor, harga_beli"
      )
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

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const purchaseCosts = await db
      .from("inventory_movements")
      .select(
        "id, tipe, jumlah, unit_cost, total_cost, reference_type, reference_id, reference_number, created_at"
      )
      .eq("raw_material_id", id)
      .eq("tipe", "in")
      .in("reference_type", PURCHASE_REFERENCE_TYPES)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false })
      .limit(limit);

    if (purchaseCosts.error) throwIfDbError(purchaseCosts.error);

    const costs = (purchaseCosts.data || []).filter(
      (movement: { unit_cost?: number | null }) => Number(movement.unit_cost || 0) > 0
    );
    const costValues: number[] = costs.map((movement: { unit_cost?: number | null }) =>
      Number(movement.unit_cost || 0)
    );

    return Response.json({
      success: true,
      data: {
        material: {
          id: material.id,
          kode: material.kode,
          nama: material.nama,
          harga_beli: Number(material.harga_beli || 0),
          konversi_factor: Number(material.konversi_factor || 1),
          satuan_besar_id: material.satuan_besar_id,
          satuan_kecil_id: material.satuan_kecil_id,
        },
        purchase_costs: costs,
        summary: {
          months,
          purchase_count: costValues.length,
          last_cost: costValues[0] ?? null,
          min_cost: costValues.length > 0 ? Math.min(...costValues) : null,
          max_cost: costValues.length > 0 ? Math.max(...costValues) : null,
          avg_cost:
            costValues.length > 0
              ? costValues.reduce((sum, value) => sum + value, 0) / costValues.length
              : null,
        },
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching raw material price history:", error);
    return Response.json(
      { success: false, message: getErrorMessage(error, "Gagal mengambil riwayat harga") },
      { status: 500 }
    );
  }
}
