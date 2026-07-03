import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { requireApiRole, ApiError } from "@/lib/api/auth";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// GET /api/purchasing/production/raw-material-recipes
export async function GET(request: NextRequest) {
  try {
    await requireApiRole(["admin", "purchasing_admin", "purchasing_manager", "warehouse_admin"]);
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    let query = db
      .from("v_raw_materials_stock")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("nama", { ascending: true })
      .limit(200);

    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    const { data: materials, error } = await query;
    if (error) throw error;

    const materialIds = (materials || []).map((row) => row.id as string);
    const { data: bomRows, error: bomError } = materialIds.length > 0
      ? await db
          .from("raw_material_bom_items")
          .select("output_raw_material_id")
          .in("output_raw_material_id", materialIds)
          .eq("is_active", true)
      : { data: [], error: null };

    if (bomError) throw bomError;

    const bomCountMap = new Map<string, number>();
    for (const row of bomRows || []) {
      const outputId = row.output_raw_material_id as string;
      bomCountMap.set(outputId, (bomCountMap.get(outputId) || 0) + 1);
    }

    const enriched = (materials || []).map((material) => ({
      ...material,
      total_bahan_baku: bomCountMap.get(material.id as string) || 0,
      hpp_estimasi: toNumber(material.avg_cost),
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching raw material recipes:", error);
    return NextResponse.json(
      { success: false, message: getErrorMessage(error, "Failed to load raw material recipes") },
      { status: 500 }
    );
  }
}
