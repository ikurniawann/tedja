// EPIC-026 C2 — Detail saldo + kartu stok (pergerakan) satu baris supply_inventory.
// GET /api/purchasing/inventory/supply/[id]
import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getApiUserScope } from "@/lib/api/scope";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await getApiUserScope();
    if (!scope) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;

    const header = await queryOne(
      `SELECT si.id,
              si.supply_item_id,
              si.warehouse_id,
              w.name AS warehouse_nama,
              s.kode AS item_kode,
              s.nama AS item_nama,
              s.kategori AS item_kategori,
              s.stockable,
              u.nama AS satuan_nama,
              COALESCE(si.qty_available, 0) AS qty_available,
              COALESCE(si.qty_on_order, 0) AS qty_on_order,
              GREATEST(COALESCE(si.qty_minimum, 0), COALESCE(s.stok_minimum, 0)) AS qty_minimum,
              COALESCE(si.unit_cost, 0) AS unit_cost,
              si.branch_id,
              si.last_movement_at
       FROM supply_inventory si
       JOIN supply_items s ON s.id = si.supply_item_id
       LEFT JOIN configuration.warehouses w ON w.id = si.warehouse_id
       LEFT JOIN units u ON u.id = s.satuan_id
       WHERE si.id = $1`,
      [id]
    );

    if (!header) {
      return NextResponse.json({ success: false, message: "Stok tidak ditemukan" }, { status: 404 });
    }

    if (!scope.isUnscoped && header.branch_id && header.branch_id !== scope.branchId) {
      return NextResponse.json({ success: false, message: "Stok tidak ditemukan" }, { status: 404 });
    }

    const movements = await query(
      `SELECT id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
              reference_type, reference_id, reference_number, alasan, catatan, created_at
       FROM supply_inventory_movements
       WHERE supply_inventory_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 200`,
      [id]
    );

    return NextResponse.json({ success: true, data: { ...header, movements } });
  } catch (error) {
    console.error("Error loading supply inventory detail:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat detail stok" },
      { status: 500 }
    );
  }
}
