import { NextRequest, NextResponse } from "next/server";
import { createServerPgClient } from "@/lib/pg/create-client";

function toQty(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// GET /api/purchasing/grn/[id]/returnable-items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = await createServerPgClient();
    const grnId = (await params).id;
    const excludeReturnId = new URL(request.url).searchParams.get("exclude_return_id");

    const { data: qc, error: qcError } = await db
      .from("grn_qc_inspections")
      .select("id, inventory_posted")
      .eq("grn_id", grnId)
      .maybeSingle();

    if (qcError) throw qcError;

    if (!qc?.inventory_posted) {
      return NextResponse.json({ success: true, data: [] });
    }

    const excludeQtyByGrnItem = new Map<string, number>();
    if (excludeReturnId) {
      const { data: existingLines, error: linesError } = await db
        .from("purchase_return_items")
        .select("grn_item_id, qty_returned")
        .eq("return_id", excludeReturnId);

      if (linesError) throw linesError;

      for (const line of existingLines || []) {
        if (!line.grn_item_id) continue;
        excludeQtyByGrnItem.set(
          line.grn_item_id,
          (excludeQtyByGrnItem.get(line.grn_item_id) || 0) + toQty(line.qty_returned)
        );
      }
    }

    const { data: items, error } = await db
      .from("grn_items")
      .select(
        `
        id,
        grn_id,
        raw_material_id,
        qty_diterima,
        qty_returned,
        qty_qc_posted,
        batch_number,
        expiry_date,
        qc_status,
        warehouse_id,
        raw_material:raw_materials!inner (
          kode,
          nama
        ),
        grn:grn!inner (
          supplier_id,
          supplier:suppliers!inner (
            nama_supplier
          )
        ),
        purchase_order_item:purchase_order_items (
          harga_satuan
        ),
        satuan:units (
          nama
        ),
        warehouse:warehouses (
          name
        )
      `
      )
      .eq("grn_id", grnId)
      .eq("is_active", true);

    if (error) throw error;

    type GrnItemRow = {
      id: string;
      grn_id: string;
      raw_material_id: string;
      qty_diterima: number | null;
      qty_returned: number | null;
      qty_qc_posted: number | null;
      batch_number: string | null;
      expiry_date: string | null;
      qc_status: string | null;
      warehouse_id: string | null;
      raw_material: { kode: string; nama: string };
      grn: { supplier_id: string; supplier: { nama_supplier: string } };
      purchase_order_item: { harga_satuan: number | null } | null;
      satuan: { nama: string | null } | null;
      warehouse: { name: string | null } | null;
    };

    const mapped = ((items || []) as GrnItemRow[])
      .map((item) => {
        const giveBack = excludeQtyByGrnItem.get(item.id) || 0;
        const qtyAvailable = Math.max(
          0,
          toQty(item.qty_qc_posted) - toQty(item.qty_returned) + giveBack
        );

        return {
          grn_item_id: item.id,
          grn_id: item.grn_id,
          raw_material_id: item.raw_material_id,
          raw_material_kode: item.raw_material.kode,
          raw_material_nama: item.raw_material.nama,
          qty_diterima: toQty(item.qty_diterima),
          qty_returned: toQty(item.qty_returned),
          qty_available_to_return: qtyAvailable,
          unit_price: toQty(item.purchase_order_item?.harga_satuan),
          batch_number: item.batch_number,
          expiry_date: item.expiry_date,
          qc_status: item.qc_status,
          supplier_id: item.grn.supplier_id,
          nama_supplier: item.grn.supplier.nama_supplier,
          satuan: item.satuan?.nama || undefined,
          warehouse_id: item.warehouse_id,
          warehouse_name: item.warehouse?.name || undefined,
        };
      })
      .filter((item) => item.qty_available_to_return > 0);

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: unknown) {
    console.error("Error fetching returnable items:", error);
    const message =
      error instanceof Error ? error.message : "Failed to load returnable items";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
