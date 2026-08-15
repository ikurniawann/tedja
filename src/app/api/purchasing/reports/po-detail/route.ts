import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiRole, ApiError, successResponse } from "@/lib/api/auth";
import { formatRupiah } from "@/lib/purchasing/utils";

// GET /api/purchasing/reports/po-detail

const querySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  status: z.string().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function mapLineItem(item: Record<string, any>) {
  const raw = item.raw_material || null;
  const product = item.product || null;
  const unit = item.satuan || null;
  const qtyOrder = toNumber(item.qty_ordered ?? item.qty_order ?? item.quantity);
  const harga = toNumber(item.harga_satuan ?? item.unit_price);
  const subtotal = toNumber(item.subtotal) || qtyOrder * harga;

  return {
    id: item.id || item.raw_material_id || item.product_id,
    nama_bahan: raw?.nama || product?.nama || item.nama_bahan || item.nama || "-",
    kode_bahan: raw?.kode || product?.kode || item.kode_bahan || item.kode || "",
    qty_order: qtyOrder,
    qty_received: toNumber(item.qty_received),
    harga_satuan: harga,
    satuan: unit?.nama || unit?.kode || item.satuan_nama || item.satuan || "",
    subtotal,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireApiRole([
      "admin",
      "super_admin",
      "purchasing_admin",
      "purchasing_manager",
      "purchasing_staff",
    ]);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const { date_from, date_to, vendor_id, status, export: exportFormat } = params;

    let poQuery = db
      .from("v_purchase_orders")
      .select("*")
      .order("tanggal_po", { ascending: false });

    if (date_from) poQuery = poQuery.gte("tanggal_po", date_from);
    if (date_to) poQuery = poQuery.lte("tanggal_po", date_to);
    if (vendor_id) poQuery = poQuery.eq("supplier_id", vendor_id);
    if (status) poQuery = poQuery.eq("status", status.toLowerCase());

    const { data: pos, error: poError } = await poQuery;
    if (poError) throw poError;

    if (!pos || pos.length === 0) {
      return successResponse({
        summary: [],
        by_status: [],
        grand_total: 0,
        grand_total_formatted: formatRupiah(0),
      });
    }

    const poIds = pos.map((po: { id: string }) => po.id);
    const { data: items, error: itemsError } = await db
      .from("purchase_order_items")
      .select(
        `
        id,
        purchase_order_id,
        raw_material_id,
        product_id,
        qty_ordered,
        qty_received,
        harga_satuan,
        subtotal,
        is_active,
        raw_material:raw_materials!raw_material_id (id, kode, nama),
        product:products!product_id (id, kode, nama),
        satuan:units!satuan_id (id, kode, nama)
      `
      )
      .in("purchase_order_id", poIds)
      .eq("is_active", true);

    if (itemsError) throw itemsError;

    const itemsByPoId: Record<string, ReturnType<typeof mapLineItem>[]> = {};
    (items || []).forEach((item: Record<string, any>) => {
      const poId = item.purchase_order_id as string;
      if (!itemsByPoId[poId]) itemsByPoId[poId] = [];
      itemsByPoId[poId].push(mapLineItem(item));
    });

    const detailedPOs = (pos || []).map((po: Record<string, any>) => {
      const poItems = itemsByPoId[po.id] || [];
      const amount = toNumber(po.total ?? po.total_amount ?? po.payable_amount);
      const statusKey = String(po.status || "unknown").toLowerCase();

      return {
        id: po.id,
        po_number: po.nomor_po || po.po_number,
        vendor: po.nama_supplier || po.supplier_name || po.vendor_name || "-",
        vendor_code:
          po.supplier_kode || po.kode_supplier || po.supplier_code || po.vendor_code || "",
        supplier_id: po.supplier_id,
        status: statusKey,
        tanggal_po: po.tanggal_po,
        tanggal_diterima: po.tanggal_diterima || null,
        total_amount: amount,
        total_amount_formatted: formatRupiah(amount),
        mata_uang: po.currency || "IDR",
        item_count: poItems.length,
        created_by: po.created_by_name || po.created_by || "-",
        items: poItems,
      };
    });

    const byStatus: Record<string, { count: number; total: number }> = {};
    let grandTotal = 0;

    detailedPOs.forEach((po) => {
      grandTotal += po.total_amount;
      if (!byStatus[po.status]) byStatus[po.status] = { count: 0, total: 0 };
      byStatus[po.status].count++;
      byStatus[po.status].total += po.total_amount;
    });

    if (exportFormat === "csv") {
      const headerRow = [
        "No PO",
        "Tanggal",
        "Supplier",
        "Supplier Code",
        "Status",
        "Nama Bahan",
        "Kode Bahan",
        "Qty Order",
        "Qty Diterima",
        "Harga Satuan",
        "Subtotal",
        "Total PO",
        "Mata Uang",
        "Created By",
      ];

      const rows: string[][] = [];

      for (const po of detailedPOs) {
        if (po.items.length === 0) {
          rows.push([
            po.po_number,
            po.tanggal_po || "",
            po.vendor || "",
            po.vendor_code || "",
            po.status,
            "-",
            "-",
            "",
            "",
            "",
            "",
            String(po.total_amount),
            po.mata_uang,
            po.created_by || "",
          ]);
        } else {
          po.items.forEach((item, idx) => {
            rows.push([
              idx === 0 ? po.po_number : "",
              idx === 0 ? po.tanggal_po || "" : "",
              idx === 0 ? po.vendor || "" : "",
              idx === 0 ? po.vendor_code || "" : "",
              idx === 0 ? po.status : "",
              item.nama_bahan,
              item.kode_bahan || "",
              String(item.qty_order),
              String(item.qty_received),
              String(item.harga_satuan),
              String(item.subtotal),
              idx === 0 ? String(po.total_amount) : "",
              idx === 0 ? po.mata_uang : "",
              idx === 0 ? po.created_by : "",
            ]);
          });
        }
      }

      const csvContent = [
        headerRow.map((h) => `"${h}"`).join(","),
        ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")),
      ].join("\n");

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="po-detail-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    return successResponse({
      summary: detailedPOs,
      by_status: Object.entries(byStatus).map(([k, v]) => ({
        status: k,
        count: v.count,
        total: Math.round(v.total * 100) / 100,
        total_formatted: formatRupiah(v.total),
      })),
      grand_total: Math.round(grandTotal * 100) / 100,
      grand_total_formatted: formatRupiah(grandTotal),
    });
  } catch (error: unknown) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error generating PO detail report:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to generate report",
      },
      { status: 500 }
    );
  }
}
