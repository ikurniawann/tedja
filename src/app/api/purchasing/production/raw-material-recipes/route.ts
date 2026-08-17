import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { IAM } from "@/lib/iam/prefixes";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";
import { getErrorMessage, throwIfDbError } from "@/app/api/purchasing/raw-materials/_helpers";
import { MANUFACTURING_SCHEMA, PRODUCTION_API_ROLES } from "@/lib/manufacturing/constants";
import {
  isMissingRelationError,
  throwUnlessMissingBomTable,
} from "@/lib/manufacturing/bom-helpers";

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

const RECIPE_ROLES = PRODUCTION_API_ROLES;

// GET /api/purchasing/production/raw-material-recipes
export async function GET(_request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
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
    throwIfDbError(error);

    const materialIds = (materials || []).map((row) => row.id as string);
    let bomRows: Array<{ output_raw_material_id: string }> = [];

    if (materialIds.length > 0) {
      const bomResult = await db
        .from("raw_material_bom_items", MANUFACTURING_SCHEMA)
        .select("output_raw_material_id")
        .in("output_raw_material_id", materialIds)
        .eq("is_active", true);

      if (bomResult.error && isMissingRelationError(bomResult.error)) {
        console.warn(
          "[raw-material-recipes] manufacturing.raw_material_bom_items is missing; returning materials without BOM counts"
        );
      } else {
        throwUnlessMissingBomTable(bomResult.error);
        bomRows = (bomResult.data || []) as Array<{ output_raw_material_id: string }>;
      }
    }

    const bomCountMap = new Map<string, number>();
    for (const row of bomRows) {
      const outputId = row.output_raw_material_id;
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
