import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const moduleType = searchParams.get("module_type") || "raw_material";
    const db = await createServerPgClient();
    const scope = await getApiUserScope();

    if (moduleType === "product") {
      let vendorsQuery = db
        .from("vendors")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");

      const companyOr = companyScopeOr(scope);
      if (companyOr) vendorsQuery = vendorsQuery.or(companyOr);
      const branchOr = branchScopeOr(scope);
      if (branchOr) vendorsQuery = vendorsQuery.or(branchOr);

      let productsQuery = db
        .from("v_products_cogs")
        .select("id, kode, nama, satuan_id, satuan_nama, harga_modal")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("nama");

      if (companyOr) productsQuery = productsQuery.or(companyOr);
      if (branchOr) productsQuery = productsQuery.or(branchOr);

      const [{ data: vendors }, { data: products }, { data: units }] = await Promise.all([
        vendorsQuery,
        productsQuery,
        db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          vendors: vendors || [],
          products: products || [],
          units: units || [],
        },
      });
    }

    if (moduleType === "general") {
      // EPIC-026 B3 — PO barang operasional: pemasok REUSE tabel `vendors`,
      // sumber item = item.supply_items (harga_beli sbagai harga default).
      let vendorsQuery = db
        .from("vendors")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");

      const companyOr = companyScopeOr(scope);
      if (companyOr) vendorsQuery = vendorsQuery.or(companyOr);
      const branchOr = branchScopeOr(scope);
      if (branchOr) vendorsQuery = vendorsQuery.or(branchOr);

      let suppliesQuery = db
        .from("supply_items")
        .select("id, kode, nama, satuan_id, stockable, harga_beli")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("nama");

      if (companyOr) suppliesQuery = suppliesQuery.or(companyOr);
      if (branchOr) suppliesQuery = suppliesQuery.or(branchOr);

      const [{ data: vendors }, { data: supplies }, { data: units }] = await Promise.all([
        vendorsQuery,
        suppliesQuery,
        db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          vendors: vendors || [],
          supplies: supplies || [],
          units: units || [],
        },
      });
    }

    const [{ data: suppliers }, { data: materials }, { data: units }] = await Promise.all([
      db.from("suppliers").select("id, kode, nama_supplier").eq("is_active", true).order("nama_supplier"),
      db
        .from("v_raw_materials_stock")
        .select("id, kode, nama, satuan_besar_id, satuan_besar_nama, avg_cost")
        .eq("is_active", true)
        .order("nama"),
      db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        suppliers: suppliers || [],
        materials: materials || [],
        units: units || [],
      },
    });
  } catch (error) {
    console.error("Error fetching PO form data:", error);
    return NextResponse.json({ success: false, message: "Failed to load PO form data" }, { status: 500 });
  }
}
