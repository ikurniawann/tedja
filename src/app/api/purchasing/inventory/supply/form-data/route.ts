// EPIC-026 C2 — Data pendukung form pemakaian/penyesuaian barang operasional:
// daftar gudang (scope) + daftar barang stockable (scope).
// GET /api/purchasing/inventory/supply/form-data
import { NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  getApiUserScope,
  companyScopeOr,
  branchScopeOr,
} from "@/lib/api/scope";

export async function GET() {
  try {
    const scope = await getApiUserScope();
    if (!scope) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const db = await createServerPgClient();
    const companyOr = companyScopeOr(scope);
    const branchOr = branchScopeOr(scope);

    let warehousesQuery = db
      .from("warehouses", "configuration")
      .select("id, name, code")
      .eq("is_active", true)
      .order("name");
    if (branchOr) warehousesQuery = warehousesQuery.or(branchOr);

    let suppliesQuery = db
      .from("supply_items")
      .select("id, kode, nama, satuan_id, stok_minimum")
      .eq("is_active", true)
      .eq("stockable", true)
      .is("deleted_at", null)
      .order("nama");
    if (companyOr) suppliesQuery = suppliesQuery.or(companyOr);
    if (branchOr) suppliesQuery = suppliesQuery.or(branchOr);

    const [{ data: warehouses }, { data: supplies }, { data: units }] = await Promise.all([
      warehousesQuery,
      suppliesQuery,
      db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        warehouses: warehouses || [],
        supplies: supplies || [],
        units: units || [],
      },
    });
  } catch (error) {
    console.error("Error loading supply inventory form data:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat data form" },
      { status: 500 }
    );
  }
}
