// ============================================
// API ROUTE: /api/purchasing/inventory
// ============================================

import { NextRequest } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
  effectiveBranchId,
} from "@/lib/api/scope";

// GET /api/purchasing/inventory
export async function GET(request: NextRequest) {
  try {
    const db = await createServerPgClient();
    const scope = await getApiUserScope();
    const { searchParams } = new URL(request.url);

    const belowMinimum = searchParams.get("below_minimum") === "true";
    const search = searchParams.get("search");

    let query = db
      .from("v_raw_materials_stock")
      .select("*")
      .eq("is_active", true)
      .is("deleted_at", null);

    const companyOr = companyScopeOr(scope);
    if (companyOr) query = query.or(companyOr);
    const branchOr = branchScopeOr(scope);
    if (branchOr) query = query.or(branchOr);

    if (belowMinimum) {
      query = query.or("status_stok.eq.MENIPIS,status_stok.eq.HABIS");
    }

    if (search) {
      query = query.or(`nama.ilike.%${search}%,kode.ilike.%${search}%`);
    }

    const { data, error } = await query.order("nama", { ascending: true });

    if (error) throw error;

    return Response.json({ success: true, data });
  } catch (error: any) {
    console.error("Error fetching inventory:", error);
    return Response.json(
      { success: false, message: error.message || "Gagal mengambil data inventory" },
      { status: 500 }
    );
  }
}
