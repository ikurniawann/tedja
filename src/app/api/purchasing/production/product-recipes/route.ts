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

// GET /api/purchasing/production/product-recipes
export async function GET(_request: NextRequest) {
  try {
    await requireIamMenuPrefix(IAM.items);
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    let query = db
      .from("v_products_cogs")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("nama", { ascending: true })
      .limit(200);

    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    const { data: products, error } = await query;
    throwIfDbError(error);

    const productIds = (products || []).map((row) => row.id as string);
    let bomRows: Array<{ product_id: string }> = [];

    if (productIds.length > 0) {
      const bomResult = await db
        .from("bom_items", MANUFACTURING_SCHEMA)
        .select("product_id")
        .in("product_id", productIds)
        .eq("is_active", true);

      if (bomResult.error && isMissingRelationError(bomResult.error)) {
        console.warn(
          "[product-recipes] manufacturing.bom_items is missing; returning products without BOM counts"
        );
      } else {
        throwUnlessMissingBomTable(bomResult.error);
        bomRows = (bomResult.data || []) as Array<{ product_id: string }>;
      }
    }

    const bomCountMap = new Map<string, number>();
    for (const row of bomRows) {
      const productId = row.product_id;
      bomCountMap.set(productId, (bomCountMap.get(productId) || 0) + 1);
    }

    const enriched = (products || []).map((product) => {
      const liveBomCount = bomCountMap.get(product.id as string) || 0;
      return {
        ...product,
        total_bahan_baku: liveBomCount,
        hpp_estimasi: toNumber(product.hpp_estimasi ?? product.estimated_cogs),
      };
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error fetching product recipes:", error);
    return NextResponse.json(
      { success: false, message: getErrorMessage(error, "Failed to load product recipes") },
      { status: 500 }
    );
  }
}
