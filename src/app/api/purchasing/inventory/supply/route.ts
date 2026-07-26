// EPIC-026 C2 — Daftar saldo stok barang operasional (per gudang).
// GET /api/purchasing/inventory/supply?search=&warehouse_id=&low_stock=1
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getApiUserScope } from "@/lib/api/scope";

export async function GET(request: NextRequest) {
  try {
    const scope = await getApiUserScope();
    if (!scope) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || null;
    const warehouseId = searchParams.get("warehouse_id") || null;
    const lowStock = searchParams.get("low_stock") === "1";

    // Scope cabang: user ber-scope hanya melihat stok cabangnya (+ baris global null).
    const branchFilter = scope.isUnscoped ? null : scope.branchId;

    const rows = await query(
      `SELECT si.id,
              si.supply_item_id,
              si.warehouse_id,
              w.name AS warehouse_nama,
              s.kode AS item_kode,
              s.nama AS item_nama,
              s.kategori AS item_kategori,
              u.nama AS satuan_nama,
              COALESCE(si.qty_available, 0) AS qty_available,
              COALESCE(si.qty_on_order, 0) AS qty_on_order,
              GREATEST(COALESCE(si.qty_minimum, 0), COALESCE(s.stok_minimum, 0)) AS qty_minimum,
              COALESCE(si.unit_cost, 0) AS unit_cost,
              si.last_movement_at
       FROM supply_inventory si
       JOIN supply_items s ON s.id = si.supply_item_id
       LEFT JOIN configuration.warehouses w ON w.id = si.warehouse_id
       LEFT JOIN units u ON u.id = s.satuan_id
       WHERE si.is_active = true
         AND ($1::uuid IS NULL OR si.branch_id = $1 OR si.branch_id IS NULL)
         AND ($2::uuid IS NULL OR si.warehouse_id = $2)
         AND ($3::text IS NULL OR s.nama ILIKE '%' || $3 || '%' OR s.kode ILIKE '%' || $3 || '%')
         AND ($4::boolean = false OR COALESCE(si.qty_available,0) <= GREATEST(COALESCE(si.qty_minimum,0), COALESCE(s.stok_minimum,0)))
       ORDER BY s.nama ASC`,
      [branchFilter, warehouseId, search, lowStock]
    );

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error listing supply inventory:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat stok barang operasional" },
      { status: 500 }
    );
  }
}
