import { createServerPgClient } from "@/lib/pg/create-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireApiRole,
  ApiError,
  successResponse,
} from "@/lib/api/auth";
import { formatRupiah } from "@/lib/purchasing/utils";

// GET /api/purchasing/reports/po-detail

const querySchema = z.object({
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  status: z.string().optional(),
  export: z.enum(["json", "csv"]).default("json"),
});

export async function GET(request: NextRequest) {
  try {
    await requireApiRole(["admin", "purchasing_admin", "purchasing_manager", "purchasing_staff"]);
    const db = await createServerPgClient();

    const { searchParams } = new URL(request.url);
    const params = querySchema.parse(Object.fromEntries(searchParams));
    const { date_from, date_to, vendor_id, status, export: exportFormat } = params;

    // Fetch PO headers
    let poQuery = db
      .from("v_purchase_orders")
      .select("*", { count: "exact" })
      .order("tanggal_po", { ascending: false });

    if (date_from) poQuery = poQuery.gte("tanggal_po", date_from);
    if (date_to) poQuery = poQuery.lte("tanggal_po", date_to);
    if (vendor_id) poQuery = poQuery.eq("supplier_id", vendor_id);
    if (status) poQuery = poQuery.eq("status", status);

    const { data: pos, error: poError } = await poQuery;

    if (poError) throw poError;

    if (!pos || pos.length === 0) {
      return successResponse({
        summary: [],
        by_status: [],
        grand_total: 0,
      });
    }

    // Fetch all PO items for the retrieved POs
    const poIds = pos.map((po: any) => po.id);
    const { data: items, error: itemsError } = await db
      .from("v_purchase_order_items")
      .select("*")
      .in("purchase_order_id", poIds);

    if (itemsError) throw itemsError;

    // Group items by PO
    const itemsByPoId: Record<string, any[]> = {};
    (items || []).forEach((item: any) => {
      const poId = item.purchase_order_id;
      if (!itemsByPoId[poId]) itemsByPoId[poId] = [];
      itemsByPoId[poId].push(item);
    });

    // Build detailed PO list with line items
    const detailedPOs = (pos || []).map((po: any) => {
      const poItems = (itemsByPoId[po.id] || []).map((item: any) => ({
        id: item.id || item.bahan_baku_id,
        nama_bahan: item.nama_bahan || item.nama || "-",
        kode_bahan: item.kode_bahan || item.kode,
        qty_order: item.qty_order || item.quantity || 0,
        qty_received: item.qty_received || 0,
        harga_satuan: item.harga_satuan || item.unit_price || 0,
        satuan: item.satuan,
        subtotal: item.subtotal || (item.qty_order || 0) * (item.harga_satuan || 0),
      }));

      return {
        po_number: po.nomor_po || po.po_number,
        vendor: po.nama_supplier || po.supplier_name,
        vendor_code: po.kode_supplier || po.supplier_code,
        supplier_id: po.supplier_id,
        status: po.status,
        tanggal_po: po.tanggal_po,
        tanggal_diterima: po.tanggal_diterima,
        total_amount: po.total || po.total_amount || 0,
        total_amount_formatted: formatRupiah(po.total || po.total_amount || 0),
        mata_uang: po.currency || "IDR",
        item_count: poItems.length,
        created_by: po.created_by_name || "Unknown",
        items: poItems,
      };
    });

    // Calculate summary statistics
    const byStatus: Record<string, { count: number; total: number }> = {};
    let grandTotal = 0;

    detailedPOs.forEach((po: any) => {
      const amount = po.total_amount;
      grandTotal += amount;
      const statusKey = po.status || "unknown";
      if (!byStatus[statusKey]) byStatus[statusKey] = { count: 0, total: 0 };
      byStatus[statusKey].count++;
      byStatus[statusKey].total += amount;
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
          po.items.forEach((item: any, idx: number) => {
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
  } catch (error: any) {
    if (error instanceof ApiError) return error.toResponse();
    console.error("Error generating PO detail report:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to generate report" },
      { status: 500 }
    );
  }
}
